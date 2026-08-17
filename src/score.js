/**
 * 综合性能分模型（草案）— 0-100，批内相对分。
 *
 * 指标（L1 可用）：
 *  - applyMs    插件加载完成时刻（核心）
 *  - wallMs     进程总耗时（dsh 引导 + 加载）
 *  - bundleGzip client bundle gzip 体积（0 = 无 client）
 *  - hooks      hook 注册数（复杂度，越小越好）
 * 权重：加载 60（apply 35 + wall 25）/ bundle 25 / hooks 15
 *
 * 归一化：批内 min-max（0 = 最优，1 = 最差），单样本时归 0。
 * 等级：≥80 快 / ≥60 中 / <60 慢
 */
export function computeScores(entries) {
  const pick = (fn, fallback = null) => {
    const vals = entries.map(fn).filter((v) => v != null && Number.isFinite(v))
    if (vals.length === 0) return { min: fallback, max: fallback }
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }
  const apply = pick((e) => e.probeApplyMs)
  const wall = pick((e) => e.wallMs / 1000)
  const gzip = pick((e) => e.bundle.clientGzipKb)
  const hooks = pick((e) => e.hookCount)

  const norm = (v, range) => {
    if (v == null || range.max - range.min < 1e-6) return 0
    return Math.min(1, Math.max(0, (v - range.min) / (range.max - range.min)))
  }

  for (const e of entries) {
    if (!e.ok) { e.score = 0; e.level = 'fail'; continue }
    const nApply = norm(e.probeApplyMs, apply)
    const nWall = norm(e.wallMs / 1000, wall)
    const nBundle = norm(e.bundle.clientGzipKb, gzip)
    const nHooks = norm(e.hookCount, hooks)
    const score = Math.round(100 * (1 - (0.35 * nApply + 0.25 * nWall + 0.25 * nBundle + 0.15 * nHooks)))
    e.score = Math.max(0, Math.min(100, score))
    e.level = e.score >= 80 ? 'fast' : e.score >= 60 ? 'medium' : 'slow'
  }
  return entries
}
