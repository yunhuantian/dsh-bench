/**
 * E2E 模式 — 端到端真实任务（消耗用户 token，显式开启）。
 *
 * 安全设计：
 *  - 显式确认：CLI 只在你主动使用 --e2e 时运行（README 注明消耗 token、
 *    不保证无死循环）；
 *  - 功能感知任务：按插件描述生成针对性问题（不统一发 hi）；
 *  - 预算保护：墙钟 120s 超时即 kill；任务文案要求"若不可用直接说明"，
 *    避免诱导长跑；输出成本估算（基础 + 任务长度系数）；
 *  - key 来源：继承启动环境的 DEEPSEEK_API_KEY（不落盘、不展示）。
 */
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createSandboxNpm, removeSandbox } from './sandbox.js'

const E2E_TIMEOUT_MS = 120_000

/** 从插件 package.json 读描述（用于功能感知任务生成）。 */
function describeOf(pkgDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    return String(pkg.description ?? pkg.name ?? '').slice(0, 200)
  } catch {
    return ''
  }
}

/** 功能感知任务：按插件描述提问，并要求短回答（控制 token 与死循环风险）。 */
function buildTask(desc) {
  const d = desc || '该插件'
  return [
    '你是一名插件评测员。环境已安装一个插件，请实际调用它完成一件它擅长的事',
    `（插件描述：${d}）。`,
    '要求：1) 只调用一次该插件相关工具；2) 若插件没有可调用的工具，直接说明"无工具可测"并结束；',
    '3) 回答控制在 3 句话内；4) 禁止循环重试。现在开始。',
  ].join('')
}

export async function runE2E(pkg, probeDir) {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) {
    return {
      mode: 'e2e',
      target: pkg,
      ok: false,
      error: '缺少 DEEPSEEK_API_KEY —— E2E 消耗你的 token，需显式提供 key（启动环境 export DEEPSEEK_API_KEY=...）',
      estTokens: 0,
    }
  }

  const started = Date.now()
  const sandbox = await createSandboxNpm(pkg, probeDir)
  const task = buildTask(describeOf(join(sandbox.profileDir, 'node_modules', pkg)))

  return new Promise((resolve) => {
    const child = spawn(
      process.env.DSH_BENCH_DSH_CMD || (process.platform === 'win32' ? join(process.env.APPDATA || '', 'npm', 'dsh.cmd') : 'dsh'),
      ['--profile', 'headless', task],
      {
        env: { ...process.env, DSH_HOME: sandbox.home, DEEPSEEK_API_KEY: key },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: process.platform === 'win32',
      },
    )
    let out = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch { /* gone */ }
    }, E2E_TIMEOUT_MS)
    child.stdout.on('data', (c) => { out += c })
    child.on('exit', (code) => {
      clearTimeout(timer)
      removeSandbox(sandbox.home)
      // 估算：任务长度 ×2 + 基础 500（输入输出粗估），仅作提示
      const estTokens = Math.round(500 + task.length * 2 + (out.length > 0 ? out.length / 4 : 0))
      resolve({
        mode: 'e2e',
        target: pkg,
        ok: !timedOut,
        wallMs: Date.now() - started,
        timeout: timedOut,
        exitCode: code,
        estTokens,
        task: task.slice(0, 120) + (task.length > 120 ? '…' : ''),
        note: 'token 消耗为估算值，实际以供应商账单为准；E2E 不保证无死循环，超时 120s 自动中止。',
      })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      removeSandbox(sandbox.home)
      resolve({ mode: 'e2e', target: pkg, ok: false, wallMs: Date.now() - started, timeout: false, estTokens: 0, error: err.message, note: 'E2E 不保证无死循环，超时 120s 自动中止。' })
    })
  })
}
