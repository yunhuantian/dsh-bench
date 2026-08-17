/**
 * 探针插件 — 与被测插件并行加载，打点插件加载完成时刻。
 *
 * 契约：dsh 官方 bundle 插件（Node half）。
 * 时序：insert 顺序保证「被测插件 → 探针」，探针 apply 时被测插件已
 *       加载完成。探针记录 apply 时刻（相对进程启动）后写 bench-probe.json
 *       并立即退出 —— 远早于模型初始化（且沙箱无 API key，LLM 直接跳过，
 *       MISSING_CREDENTIAL），因此 L1 加载基准零 token。
 */
import { writeFileSync } from 'node:fs'

export const name = 'dsh-bench-probe'
export const inject = []

const MARKS = {
  probeApplyMs: 0,      // 探针 apply 时刻 ≈ 全部插件加载完成（相对进程启动）
  hookRegistrations: 0, // apply 后 200ms 内注册的 hook 数（近似被测贡献）
  targetName: '',
  _debugT0: 0,          // 调试：探针读到的 T0
  _debugNow: 0,         // 调试：apply 时 Date.now()
}

const OUT = process.env.DSH_BENCH_PROBE_OUT
const TARGET = process.env.DSH_BENCH_TARGET_NAME || ''
// Date.now(): epoch ms, 与 runner 跨进程共享同一时钟（t0 由 runner 注入）
const T0 = Number(process.env.DSH_BENCH_T0 ?? 0) || Date.now()
const hr = () => (Date.now() - T0) / 1000

export function apply(ctx) {
  MARKS.probeApplyMs = hr()
  MARKS._debugT0 = T0
  MARKS._debugNow = Date.now()
  MARKS.targetName = TARGET

  // 计数被测插件 apply 后（200ms 窗口内）的 hook 注册
  try {
    const origOn = ctx.on.bind(ctx)
    ctx.on = (...a) => {
      MARKS.hookRegistrations++
      return origOn(...a)
    }
  } catch { /* best-effort */ }

  // 缓冲 200ms 让异步注册落定，然后写结果并退出
  setTimeout(finish, 200)
}

function finish() {
  if (MARKS._done) return
  MARKS._done = true
  try {
    if (OUT) writeFileSync(OUT, JSON.stringify(MARKS, null, 2))
  } catch { /* result is best-effort */ }
  process.exit(0)
}
