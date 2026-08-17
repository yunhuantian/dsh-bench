# dsh-bench — 虚拟 DSH 环境跑分机

在隔离的虚拟 DSH 环境中为插件 / Skill 测量**加载与工具调用耗时**，建立独立的性能评分体系。
与 dsh-plugin-hub 完全解耦，通过 benchmark.json 报告单向消费。

## 状态

- **M1 完成**：虚拟环境工厂 + L1 加载基准 + benchmark.json（已验证零 token）
- M2 规划：L2 Mock 工具基准 + 综合性能分 + 对比视图
- M3 规划：端到端模式（token 预算保护，用户授权制）
- M4 规划：hub 消费（详情「跑分」tab）

## 用法

```bash
# 跑本机已装插件（自动枚举）
node src/index.js

# 跑指定插件（包名或目录路径）
node src/index.js gal-view
node src/index.js "E:/path/to/plugin-dir"

# 指定输出
node src/index.js --out benchmark.json
```

## 原理

1. **虚拟环境**：每个被测对象一个临时 `DSH_HOME`（`$TMP/dsh-bench-*`），
   用 junction 链接被测插件 + 探针插件，注入 profile patch —— 跑完即焚；
2. **零 token**：沙箱是全新 DSH_HOME（无 API key），headless 启动时 LLM
   直接 `MISSING_CREDENTIAL` 跳过；探针在插件加载完成后**主动退出进程**，
   先于模型初始化 —— 全程不消耗任何 token；
3. **采集**：
   - `wallMs` 进程总耗时（dsh 引导 + 插件加载）
   - `probeApplyMs` 插件全部加载完成时刻（核心加载信号）
   - `hookCount` 加载后注册的 hook 数（近似被测插件贡献）
   - `clientKb` / `clientGzipKb` client bundle 体积（L0 静态分析）
   - 机器指纹（平台/CPU/内存/Node 版本），用于跨机校准

## 结构

```
src/
  index.js        CLI 入口
  sandbox.js      虚拟环境工厂（隔离 DSH_HOME + junction + patch）
  runner.js       L1 运行器（spawn headless + 探针结果采集）
  probe/          探针插件（apply 计时 + hook 计数 + 主动退出）
  analyze.js      L0 静态分析（bundle 体积 / 依赖规模）
  report.js       benchmark.json 汇总（含机器指纹）
```

## 输出示例（benchmark.json）

```json
{
  "schema": "dsh-bench/benchmark@1",
  "machine": { "platform": "win32", "cpus": 8, "node": "v22.22.2" },
  "entries": [
    { "target": "gal-view", "ok": true, "wallMs": 4379, "probeApplyMs": 3.9, "hookCount": 60,
      "bundle": { "clientKb": 5777, "clientGzipKb": 1043, "deps": 0 } }
  ]
}
```
