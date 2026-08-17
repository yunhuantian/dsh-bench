#!/usr/bin/env node
/**
 * dsh-bench CLI — 虚拟 DSH 环境 L1 加载基准（零 token）。
 *
 * 用法：
 *   node src/index.js                        # 跑本机默认候选插件
 *   node src/index.js <target...>            # 跑指定插件（目录路径或包名）
 *   node src/index.js --out benchmark.json   # 指定输出
 *
 * 被测来源：
 *   1) 命令行参数（路径或本机已装插件名）
 *   2) 默认：本机 web profile 下已装插件目录
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSandbox, removeSandbox } from './sandbox.js'
import { runL1, resolveTarget, listPlugins } from './runner.js'
import { analyzeBundle } from './analyze.js'
import { buildReport } from './report.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROBE_DIR = join(__dirname, 'probe')
const WEB_PLUGINS = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules')
  : join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'web', 'node_modules')

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : 'benchmark.json'
const targets = args.filter((_, i) => !(i === outIdx || i === outIdx + 1))

async function main() {
  if (!existsSync(WEB_PLUGINS)) {
    console.error(`[dsh-bench] 找不到本机插件目录: ${WEB_PLUGINS}`)
    process.exit(1)
  }

  // 解析被测对象
  const requested = targets.length > 0 ? targets : listPlugins(WEB_PLUGINS, 10)
  const resolved = []
  for (const r of requested) {
    const dir = resolveTarget(r, [WEB_PLUGINS])
    if (!dir) { console.warn(`[dsh-bench] 跳过未找到: ${r}`); continue }
    let name = r
    if (r.includes(':') || r.includes('\\')) {
      try {
        const pkgPath = join(r, 'package.json')
        if (existsSync(pkgPath)) name = JSON.parse(readFileSync(pkgPath, 'utf8')).name
      } catch { /* keep raw */ }
    }
    resolved.push({ name, dir })
  }
  if (resolved.length === 0) {
    console.error('[dsh-bench] 没有可测插件')
    process.exit(1)
  }

  console.log(`[dsh-bench] L1 加载基准 — 被测 ${resolved.length} 个插件（零 token）`)
  console.log(`[dsh-bench] 机器: ${process.platform}/${process.arch} · ${process.version}`)
  console.log('')

  const entries = []
  for (const [i, t] of resolved.entries()) {
    const probeOut = join(process.env.TEMP || '/tmp', `dsh-bench-probe-${Date.now()}-${i}.json`)
    const sandbox = createSandbox(t.dir, PROBE_DIR, t.name)
    process.stdout.write(`  [${i + 1}/${resolved.length}] ${t.name} … `)
    const r1 = await runL1(sandbox.home, probeOut, t.name)
    const bundle = analyzeBundle(t.dir)
    removeSandbox(sandbox.home)
    try { rmSync(probeOut, { force: true }) } catch { /* ignore */ }

    entries.push({
      target: t.name,
      ok: r1.ok,
      wallMs: r1.wallMs,
      probeApplyMs: r1.probeApplyMs,
      readyMs: r1.readyMs,
      hookCount: r1.hookCount,
      timeout: r1.timeout,
      error: r1.error,
      bundle: {
        hasClient: bundle.hasClient,
        clientKb: bundle.clientBytes !== null ? Math.round(bundle.clientBytes / 1024) : null,
        clientGzipKb: bundle.clientGzipBytes !== null ? Math.round(bundle.clientGzipBytes / 1024) : null,
        deps: bundle.deps,
        description: bundle.description.slice(0, 120),
      },
    })
    const e = entries[entries.length - 1]
    const mark = r1.ok ? '✅' : '❌'
    const apply = r1.probeApplyMs != null ? `${r1.probeApplyMs.toFixed(1)}s` : '—'
    console.log(`\n      ${mark} wall=${r1.wallMs}ms apply=${apply} hooks=${r1.hookCount ?? '—'} client=${e.bundle.clientKb ?? '无'}KB${r1.error ? ' (' + r1.error + ')' : ''}`)
  }

  const report = buildReport(entries, { mode: 'L1', dsh: process.env.DSH_BENCH_DSH_CMD || 'dsh' })
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
  console.log('')
  console.log(`[dsh-bench] 报告已写入: ${outPath}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
