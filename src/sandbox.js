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
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
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

  writePatch(profileDir, targetName, entryIdOf(targetDir) ?? targetName)
  return { home, profileDir, targetName }
}

/** npm 包安装模式：在 sandbox profile 里 npm install <pkg>（返回 Promise）。 */
export async function createSandboxNpm(packageName, probeDir, timeoutMs = 180_000) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-bench-'))
  const profileDir = join(home, 'profiles', 'headless')
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true })

  const { spawn } = await import('node:child_process')
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  await new Promise((resolve, reject) => {
    const child = spawn(npm, ['install', '--no-save', '--no-audit', '--no-fund', packageName], {
      cwd: profileDir,
      stdio: 'ignore',
      windowsHide: true,
      shell: process.platform === 'win32',
    })
    const timer = setTimeout(() => { try { child.kill() } catch { /* gone */ } }, timeoutMs)
    child.on('exit', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error(`npm install ${packageName} exit ${code}`))
    })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
  })

  // 探针链接 + patch（entry id 取自插件自身 bundle patch）
  const nm = join(profileDir, 'node_modules')
  symlinkSync(probeDir, join(nm, 'dsh-bench-probe'), 'junction')
  const installedDir = join(nm, packageName)
  writePatch(profileDir, packageName, entryIdOf(installedDir) ?? packageName)
  return { home, profileDir, targetName: packageName }
}

/** 读插件自身 cordis.patch.yml 声明的第一个 entry id（insert: - id: xxx）。 */
function entryIdOf(pkgDir) {
  try {
    const patch = readFileSync(join(pkgDir, 'cordis.patch.yml'), 'utf8')
    const m = /-\s+id:\s*(\S+)/.exec(patch)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** profile patch 单行 insert（与 hub installer 相同格式，name/id 加引号防 YAML 保留字符）。 */
function writePatch(profileDir, packageName, entryId) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`
  const patch = [
    `# dsh-bench sandbox patch — 被测: ${packageName}`,
    `- insert: [{ id: ${q(entryId)}, name: ${q(packageName)} }]`,
    `- insert: [{ id: ${q('dsh-bench-probe')}, name: ${q('dsh-bench-probe')} }]`,
    '',
  ].join('\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), patch, 'utf8')
}

export function removeSandbox(home) {
  try { rmSync(home, { recursive: true, force: true }) } catch { /* ignore */ }
}
