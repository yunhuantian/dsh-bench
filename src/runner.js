/**
 * L1 加载基准运行器。
 *
 * 跑法：spawn dsh --profile headless（临时 DSH_HOME 已注入探针），
 * 探针在 ready 后写 bench-probe.json 并主动 exit —— 先于模型回复退出，
 * 因此进程结束时 LLM 尚未产生输出，零 token。
 *
 * 采集：
 *  - wallMs       进程总耗时（外部计时，含 dsh 引导）
 *  - probeApplyMs 探针注册时刻（≈全部插件注册完成）
 *  - readyMs      cordis ready 时刻
 *  - hookCount    全局 hook 注册数
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DSL_CMD = process.env.DSH_BENCH_DSH_CMD || (process.platform === 'win32'
  ? join(process.env.APPDATA || process.env.USERPROFILE || '', 'npm', 'dsh.cmd')
  : 'dsh')

export function runL1(home, probeOut, targetName, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    // Date.now(): epoch ms, 跨进程与探针共享同一时钟.
    const t0 = Date.now()
    const child = spawn(
      DSL_CMD,
      ['--profile', 'headless', 'noop'],
      {
        env: {
          ...process.env,
          DSH_HOME: home,
          DSH_BENCH_PROBE_OUT: probeOut,
          DSH_BENCH_TARGET_NAME: targetName,
          DSH_BENCH_T0: String(t0),
        },
        stdio: 'ignore',
        windowsHide: true,
        // .cmd wrapper on Windows requires a shell
        shell: process.platform === 'win32',
      },
    )

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch { /* gone */ }
    }, timeoutMs)

    child.on('exit', (code) => {
      clearTimeout(timer)
      const wallMs = Date.now() - t0
      let probe = null
      if (existsSync(probeOut)) {
        try { probe = JSON.parse(readFileSync(probeOut, 'utf8')) } catch { /* ignore */ }
      }
      resolve({
        ok: code === 0 && probe !== null,
        target: targetName,
        wallMs,
        probeApplyMs: typeof probe?.probeApplyMs === 'number' ? probe.probeApplyMs : null,
        readyMs: typeof probe?.readyMs === 'number' ? probe.readyMs : null,
        hookCount: typeof probe?.hookRegistrations === 'number' ? probe.hookRegistrations : null,
        exitCode: code,
        timeout: timedOut,
        error: timedOut ? 'timeout' : code !== 0 ? `exit ${code}` : undefined,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, target: targetName, wallMs: Date.now() - t0, probeApplyMs: null, readyMs: null, hookCount: null, exitCode: null, timeout: false, error: err.message })
    })
  })
}

/** 被测插件目录解析：包名（在本机已装插件中查找，含 scoped）或直接路径。 */
export function resolveTarget(dirOrName, candidates) {
  const isPath = dirOrName.includes(':') || dirOrName.includes('\\')
  if (isPath) return existsSync(dirOrName) ? dirOrName : null
  for (const root of candidates) {
    const p = join(root, dirOrName)
    if (existsSync(join(p, 'package.json'))) return p
  }
  return null
}

/** 枚举插件目录下的 dsh 插件（有 cordis.patch.yml 的，含 scoped 包）。 */
export function listPlugins(candidateRoot, max = 50) {
  const out = []
  try {
    for (const n of readdirSync(candidateRoot)) {
      if (n.startsWith('@')) {
        // scoped: @scope/name
        const scopeDir = join(candidateRoot, n)
        let names = []
        try { names = readdirSync(scopeDir) } catch { continue }
        for (const sub of names) {
          const p = join(scopeDir, sub)
          if (existsSync(join(p, 'package.json')) && existsSync(join(p, 'cordis.patch.yml'))) out.push(`${n}/${sub}`)
          if (out.length >= max) return out
        }
      } else {
        const p = join(candidateRoot, n)
        if (existsSync(join(p, 'package.json')) && existsSync(join(p, 'cordis.patch.yml'))) out.push(n)
      }
      if (out.length >= max) return out
    }
  } catch { /* ignore */ }
  return out
}

/**
 * L2 Mock — 隔离子进程测插件 Node half 顶层模块执行耗时（冷加载）。
 * 独立 node 进程 import 插件 main（cwd=sandbox，依赖可解析）；只执行顶层
 * 代码（定义/注册），不触发 apply —— 零 token、不污染主进程。
 */
export function l2MockMain(pluginDir, cwd, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    try {
      const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
      const main = join(pluginDir, String(pkg.main ?? 'index.js'))
      if (!existsSync(main)) return resolve({ ok: false, mainEvalMs: null, error: 'no main' })
      const script = `const t0=Date.now();await import(process.argv[1]);console.log('EVAL_MS='+(Date.now()-t0));`
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, main], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let out = ''
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; try { child.kill() } catch { /* gone */ } }, timeoutMs)
      child.stdout.on('data', (c) => { out += c })
      child.on('exit', (code) => {
        clearTimeout(timer)
        const m = /EVAL_MS=(\d+)/.exec(out)
        resolve({ ok: m !== null && code === 0, mainEvalMs: m ? Number(m[1]) : null, error: timedOut ? 'timeout' : m ? undefined : `exit ${code}` })
      })
    } catch (e) {
      resolve({ ok: false, mainEvalMs: null, error: e.message })
    }
  })
}
