/**
 * 对比视图 — 生成自包含 HTML 报告（无外部依赖，本地打开即可看）。
 * 深色主题；按 score 排序；wall / apply / bundle gzip 三组柱状图 + 明细表。
 */
export function renderView(report) {
  const entries = [...(report.entries ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const m = report.machine ?? {}
  const maxWall = Math.max(...entries.map((e) => e.wallMs || 0), 1)
  const maxApply = Math.max(...entries.map((e) => e.probeApplyMs || 0), 1)
  const maxGzip = Math.max(...entries.map((e) => e.bundle?.clientGzipKb || 0), 1)

  const rows = entries.map((e) => {
    const pct = (v, max) => Math.min(100, Math.max(2, ((v || 0) / max) * 100))
    const color = e.level === 'fast' ? '#4ade80' : e.level === 'medium' ? '#facc15' : '#f87171'
    const badge = e.ok ? `<span style="color:${color}">● ${e.level ?? '—'}</span>` : '<span style="color:#f87171">✗ 失败</span>'
    return `
    <div class="row">
      <div class="head">
        <span class="name">${esc(e.target)}</span>
        <span class="score" style="color:${color}">${e.score ?? '—'}</span>
        <span class="level">${badge}${e.error ? ` <span class="err">(${esc(e.error)})</span>` : ''}</span>
      </div>
      <div class="bars">
        <div class="bar"><span class="bl">wall</span><div class="track"><div class="fill wall" style="width:${pct(e.wallMs, maxWall)}%"></div></div><span class="bv">${e.wallMs}ms</span></div>
        <div class="bar"><span class="bl">apply</span><div class="track"><div class="fill apply" style="width:${pct(e.probeApplyMs, maxApply)}%"></div></div><span class="bv">${e.probeApplyMs?.toFixed(2) ?? '—'}s</span></div>
        <div class="bar"><span class="bl">bundle</span><div class="track"><div class="fill bundle" style="width:${pct(e.bundle?.clientGzipKb, maxGzip)}%"></div></div><span class="bv">${e.bundle?.clientGzipKb ?? '无'}KB</span></div>
      </div>
      <div class="meta">hooks=${e.hookCount ?? '—'} · client=${e.bundle?.clientKb ?? '无'}KB · deps=${e.bundle?.deps ?? '—'}${e.bundle?.description ? ' · ' + esc(e.bundle.description) : ''}</div>
    </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>dsh-bench · L1 加载基准</title>
<style>
  body { margin: 0; padding: 24px; background: #14181f; color: #e6e6e6; font: 13px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #8b93a3; font-size: 12px; margin-bottom: 20px; }
  .row { background: #1c232e; border: 1px solid #2a3342; border-radius: 10px; padding: 12px 16px; margin-bottom: 10px; }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .name { font-weight: 600; font-size: 14px; }
  .score { font-size: 18px; font-weight: 700; min-width: 34px; }
  .level { font-size: 12px; color: #8b93a3; }
  .err { color: #f87171; }
  .bars { display: grid; gap: 4px; }
  .bar { display: flex; align-items: center; gap: 8px; }
  .bl { width: 48px; color: #8b93a3; font-size: 11px; text-align: right; }
  .track { flex: 1; height: 10px; background: #2a3342; border-radius: 5px; overflow: hidden; }
  .fill { height: 100%; border-radius: 5px; }
  .fill.wall { background: #60a5fa; }
  .fill.apply { background: #a78bfa; }
  .fill.bundle { background: #34d399; }
  .bv { width: 64px; font-size: 11px; color: #c9d1dc; }
  .meta { margin-top: 8px; color: #8b93a3; font-size: 11px; }
</style>
</head>
<body>
<h1>dsh-bench · L1 加载基准（零 token）</h1>
<div class="sub">${esc(report.generatedAt)} · ${esc(m.platform)}/${esc(m.arch)} · ${m.cpus} CPU · Node ${esc(m.node)} · 模式 ${esc(report.meta?.mode ?? 'L1')}</div>
${rows}
</body>
</html>`
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
