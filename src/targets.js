/**
 * 被测清单扩展 — 数据源：
 *   1) hub 镜像 DB（~/.dsh/storages/plugin-store/plugin-store.sqlite）Top N
 *   2) fixtures/targets.json 手动清单（{ name, install: 'npm' | 'dir', dir? }）
 */
import { existsSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const DEFAULT_DB = join(
  process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'),
  'storages', 'plugin-store', 'plugin-store.sqlite',
)

/** 从 hub 镜像 DB 读 Top N 插件（按 stars），返回 [{name, stars, downloads}]。 */
export function topPluginsFromHub(n = 10, dbPath = DEFAULT_DB) {
  if (!existsSync(dbPath)) return []
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const rows = db.prepare(
      'SELECT package_name, stars, downloads FROM plugins ORDER BY stars DESC LIMIT ?',
    ).all(n)
    db.close()
    return rows.map((r) => ({ name: String(r.package_name), stars: Number(r.stars ?? 0), downloads: Number(r.downloads ?? 0) }))
  } catch {
    return []
  }
}

/** 读取 fixtures/targets.json（可选）。 */
export function readTargetsFile(path) {
  if (!existsSync(path)) return []
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** 组装被测清单：--top N（hub DB）→ fixtures → 命令行参数（覆盖/追加）。 */
export function resolveTargets({ top = 0, cliTargets = [], fixturesPath = null }) {
  const out = new Map()
  if (top > 0) {
    for (const p of topPluginsFromHub(top)) {
      out.set(p.name, { name: p.name, install: 'npm', stars: p.stars, downloads: p.downloads })
    }
  }
  if (fixturesPath) {
    for (const t of readTargetsFile(fixturesPath)) {
      out.set(t.name, { name: t.name, install: t.install ?? 'npm', dir: t.dir ?? null, stars: t.stars ?? 0 })
    }
  }
  for (const raw of cliTargets) {
    if (raw.includes(':') || raw.includes('\\')) {
      out.set(raw, { name: raw, install: 'dir', dir: raw, stars: 0 })
    } else {
      out.set(raw, { name: raw, install: 'npm', stars: 0 })
    }
  }
  return [...out.values()]
}
