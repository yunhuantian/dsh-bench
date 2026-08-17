/**
 * dsh-bench Node half — 极简插件入口。
 * 本体是 CLI（src/index.js），这里让 dsh 能把它当 bundle 插件安装，
 * 从而出现在 hub 的「自创作插件」分类（可扩展类）。
 * 真正的"立即跑分"由 dsh-plugin-hub 的 benchRun Remote 调用本包 CLI 完成。
 */
export const name = 'dsh-bench'
export const inject = []

export function apply() {
  // 无宿主侧行为：跑分能力通过 CLI (dsh-bench) 暴露，由 hub 调用。
}
