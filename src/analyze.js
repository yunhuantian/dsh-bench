/**
 * L0 静态分析 — 被测插件的 bundle 与元数据（零运行）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

/** 读取插件 package.json 的 client 产物与依赖规模。 */
export function analyzeBundle(targetDir) {
  const pkgPath = join(targetDir, 'package.json')
  const empty = { hasClient: false, clientBytes: null, clientGzipBytes: null, deps: 0, categories: [], description: '' }
  if (!existsSync(pkgPath)) return empty
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const deps = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.peerDependencies ?? {}).length

    // client 产物：package.json dsh.client 指向，或常见路径
    let clientPath = null
    const dc = pkg.dsh?.client
    if (dc?.file) clientPath = join(targetDir, String(dc.file))
    else if (dc?.bundle) clientPath = join(targetDir, String(dc.bundle))
    if (!clientPath) {
      for (const cand of ['.dsh-plugin/client.js', 'dist/client.js', 'client.js']) {
        const p = join(targetDir, cand)
        if (existsSync(p)) { clientPath = p; break }
      }
    }

    let clientBytes = null
    let clientGzipBytes = null
    if (clientPath && existsSync(clientPath)) {
      clientBytes = statSync(clientPath).size
      clientGzipBytes = gzipSize(readFileSync(clientPath))
    }

    return {
      hasClient: clientBytes !== null,
      clientBytes,
      clientGzipBytes,
      deps,
      categories: Array.isArray(pkg.dsh?.categories) ? pkg.dsh.categories : [],
      description: String(pkg.description ?? ''),
    }
  } catch {
    return empty
  }
}

function gzipSize(buf) {
  try {
    return gzipSync(buf).length
  } catch {
    return buf.length
  }
}
