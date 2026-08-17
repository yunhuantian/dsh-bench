/**
 * 虚拟环境工厂 — 为每个被测对象创建隔离的临时 DSH_HOME。
 *
 * 结构：
 *   $TMP/dsh-bench-<rand>/                    ← 临时 DSH_HOME
 *     profiles/headless/
 *       node_modules/<target>/                 ← junction 链接被测插件
 *       node_modules/dsh-bench-probe/          ← junction 链接探针
 *       cordis.patch.yml                       ← insert 被测 + 探针
 *
 * 使用 junction（目录链接）而非复制：省空间、被测插件自带依赖直接可用。
 * 跑完由 removeSandbox 清理（即测即焚）。
 */
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function createSandbox(targetDir, probeDir, targetName) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-bench-'))
  const profileDir = join(home, 'profiles', 'headless')
  const nm = join(profileDir, 'node_modules')
  mkdirSync(nm, { recursive: true })

  // 链接被测插件
  symlinkSync(targetDir, join(nm, targetName), 'junction')
  // 链接探针
  symlinkSync(probeDir, join(nm, 'dsh-bench-probe'), 'junction')

  // profile patch：先被测后探针（被测先加载，探针最后 ready 时打点）
  const patch = [
    `# dsh-bench sandbox patch — 被测: ${targetName}`,
    '- insert:',
    `    - id: ${targetName}`,
    `      name: ${targetName}`,
    '- insert:',
    '    - id: dsh-bench-probe',
    '      name: dsh-bench-probe',
    '',
  ].join('\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), patch, 'utf8')

  return { home, profileDir, targetName }
}

export function removeSandbox(home) {
  try { rmSync(home, { recursive: true, force: true }) } catch { /* ignore */ }
}
