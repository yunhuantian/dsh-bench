/**
 * 汇总 — 输出 benchmark.json（L1 结果 + L0 静态分析 + 机器指纹）。
 */
import { hostname, cpus, totalmem, release } from 'node:os'

export function buildReport(entries, meta) {
  return {
    schema: 'dsh-bench/benchmark@1',
    generatedAt: new Date().toISOString(),
    machine: {
      hostname: hostname(),
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
      cpuModel: cpus()[0]?.model ?? '',
      totalMemMb: Math.round(totalmem() / 1024 / 1024),
      osRelease: release(),
      node: process.version,
    },
    meta,
    entries,
  }
}
