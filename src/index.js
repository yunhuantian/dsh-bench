#!/usr/bin/env node
/**
 * dsh-bench CLI — 虚拟 DSH 环境 L1 加载基准（零 token）。
 *
 * 用法：
 *   node src/index.js                          # 本机已装插件
 *   node src/index.js --top 5                 # hub 镜像 DB Top 5（npm 安装到沙箱）
 *   node src/index.js aegis dsh-cc-tui        # 指定 npm 包
 *   node src/index.js "E:/path/to/plugin"     # 指定本地目录
 *   node src/index.js --fixtures fixtures/targets.json
 *   node src/index.js --out benchmark.json --view   # 输出 json + HTML 对比视图
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSandbox, createSandboxNpm, removeSandbox } from './sandbox.js'
import { runL1, resolveTarget, listPlugins, l2MockMain } from './runner.js'
import { analyzeBundle } from './analyze.js'
import { buildReport } from './report.js'
import { computeScores } from './score.js'
import { renderView } from './view.js'
import { resolveTargets } from './targets.js'
import { runE2E } from './e2e.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROBE_DIR = join(__dirname, 'probe')
const WEB_PLUGINS = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules')
  : join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'web', 'node_modules')

function parseArgs(argv) {
  const opts = {}
  const targets = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--top' || a === '--out' || a === '--fixtures' || a === '--history') {
      opts[a.slice(2)] = argv[++i]
    } else if (a === '--view' || a === '--keep' || a === '--e2e' || a === '--no-l2') {
      opts[a.slice(2)] = true
    } else {
      targets.push(a)
    }
  }
  return { opts, targets }
}

async function main() {
  const { opts, targets: cliTargets } = parseArgs(process.argv.slice(2))
  const outPath = opts.out || 'benchmark.json'
  const wantView = opts.view
  const top = Number(opts.top || 0)
  const fixturesPath = opts.fixtures ?? null
  const keepSandbox = opts.keep
  const historyPath = opts.history || null

  // E2E 模式（消耗 token，用户显式开启）：--e2e <pkg>
  if (opts.e2e) {
    const pkg = cliTargets[0]
    if (!pkg) { console.error('[dsh-bench] --e2e 需要指定插件包名'); process.exit(1) }
    const report = await runE2E(pkg, PROBE_DIR)
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(`[dsh-bench] E2E 报告已写入: ${outPath}`)
    console.log(`[dsh-bench] 本次消耗估算: ${report.estTokens} tokens（实际以供应商账单为准）`)
    return
  }

  // 被测清单
  let targets
  if (cliTargets.length > 0) {
    // CLI 目标：先匹配本机已装（dir），否则当 npm 包
    targets = cliTargets.map((r) => {
      const local = resolveTarget(r, [WEB_PLUGINS])
      return local ? { name: r, install: 'dir', dir: local } : { name: r, install: 'npm' }
    })
  } else if (top > 0 || fixturesPath) {
    targets = resolveTargets({ top, fixturesPath })
  } else {
    targets = listPlugins(WEB_PLUGINS, 10).map((n) => {
      const dir = resolveTarget(n, [WEB_PLUGINS])
      return { name: n, install: 'dir', dir }
    })
  }
  if (targets.length === 0) {
    console.error('[dsh-bench] 没有可测对象')
    process.exit(1)
  }

  console.log(`[dsh-bench] L1 加载基准 — 被测 ${targets.length} 个（零 token）`)
  console.log(`[dsh-bench] 机器: ${process.platform}/${process.arch} · ${process.version}`)
  console.log('')

  const entries = []
  for (const [i, t] of targets.entries()) {
    const probeOut = join(process.env.TEMP || '/tmp', `dsh-bench-probe-${Date.now()}-${i}.json`)
    let sandbox = null
    process.stdout.write(`  [${i + 1}/${targets.length}] ${t.name} … `)
    try {
      if (t.install === 'npm') {
        const started = Date.now()
        try {
          sandbox = await createSandboxNpm(t.name, PROBE_DIR)
        } catch (e) {
          console.log(`\n      ❌ 安装失败: ${e.message}`)
          entries.push({ target: t.name, ok: false, wallMs: Date.now() - started, probeApplyMs: null, readyMs: null, hookCount: null, timeout: false, error: e.message, bundle: { hasClient: false, clientKb: null, clientGzipKb: null, deps: 0, description: '' } })
          continue
        }
      } else {
        sandbox = createSandbox(t.dir, PROBE_DIR, t.name)
      }
      const r1 = await runL1(sandbox.home, probeOut, t.name)
      const pluginDir = sandbox.profileDir ? join(sandbox.profileDir, 'node_modules', t.name) : t.dir
      const bundle = analyzeBundle(pluginDir)
      // L2 Mock: 隔离子进程测 Node half 顶层执行（零 token）
      const l2 = await l2MockMain(pluginDir, sandbox.profileDir || t.dir)
      entries.push({
        target: t.name,
        ok: r1.ok,
        wallMs: r1.wallMs,
        probeApplyMs: r1.probeApplyMs,
        hookCount: r1.hookCount,
        timeout: r1.timeout,
        error: r1.error,
        l2: { mainEvalMs: l2.mainEvalMs, error: l2.error ?? null },
        bundle: {
          hasClient: bundle.hasClient,
          clientKb: bundle.clientBytes !== null ? Math.round(bundle.clientBytes / 1024) : null,
          clientGzipKb: bundle.clientGzipBytes !== null ? Math.round(bundle.clientGzipBytes / 1024) : null,
          deps: bundle.deps,
          description: bundle.description.slice(0, 120),
        },
      })
      const e = entries[entries.length - 1]
      const mark = e.ok ? '✅' : '❌'
      const apply = e.probeApplyMs != null ? `${e.probeApplyMs.toFixed(1)}s` : '—'
      console.log(`\n      ${mark} wall=${e.wallMs}ms apply=${apply} hooks=${e.hookCount ?? '—'} client=${e.bundle.clientKb ?? '无'}KB${e.error ? ' (' + e.error + ')' : ''}`)
    } catch (e) {
      console.log(`\n      ❌ ${e.message}`)
      entries.push({ target: t.name, ok: false, wallMs: 0, probeApplyMs: null, hookCount: null, timeout: false, error: e.message, bundle: { hasClient: false, clientKb: null, clientGzipKb: null, deps: 0, description: '' } })
    } finally {
      if (sandbox && !keepSandbox) removeSandbox(sandbox.home)
      try { rmSync(probeOut, { force: true }) } catch { /* ignore */ }
    }
  }

  computeScores(entries)
  const report = buildReport(entries, { mode: 'L1', dsh: process.env.DSH_BENCH_DSH_CMD || 'dsh' })
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
  console.log('')
  console.log(`[dsh-bench] 报告已写入: ${outPath}`)

  // 分数汇总
  console.log('[dsh-bench] 综合性能分（批内相对）:')
  const sorted = [...entries].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  for (const e of sorted) {
    const l2 = e.l2?.mainEvalMs != null ? ` eval=${e.l2.mainEvalMs}ms` : ''
    console.log(`   ${String(e.score ?? '—').padStart(3)}  ${e.level ?? '—'.padEnd(6)}  ${e.target}${l2}`)
  }

  // 历史趋势：追加 summary 到 history 文件（跨版本回退检测）
  let previous = null
  if (historyPath) {
    mkdirSync(dirname(historyPath), { recursive: true })
    let history = []
    if (existsSync(historyPath)) {
      try { history = JSON.parse(readFileSync(historyPath, 'utf8')) } catch { history = [] }
    }
    previous = history.length > 0 ? history[history.length - 1] : null
    const summary = {
      at: report.generatedAt,
      dsh: report.meta?.dsh ?? null,
      targets: Object.fromEntries(entries.map((e) => [e.target, { score: e.score ?? null, level: e.level ?? null, wallMs: e.wallMs, applyMs: e.probeApplyMs }])),
    }
    history.push(summary)
    history = history.slice(-50)
    writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8')
    console.log(`[dsh-bench] 历史已追加: ${historyPath}（共 ${history.length} 次）`)
  }

  if (wantView) {
    const htmlPath = outPath.replace(/\.json$/i, '') + '-view.html'
    writeFileSync(htmlPath, renderView(report, previous), 'utf8')
    console.log(`[dsh-bench] 对比视图: ${htmlPath}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
