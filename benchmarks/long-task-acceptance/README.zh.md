# 长任务验收基准

[English](README.md) | 中文

## 概述

这个基准回答一个问题：长任务相关的机制到底有没有触发。它是机制回归探针，不是模型能力评测——模型回放固定脚本，因此失败指向 harness 而不是模型。

三个场景在隔离进程里走真实的 agent loop、真实工具、真实 guard 与真实投影：

| 场景 | 脚本 | 证明什么 |
|---|---|---|
| `false-success` | 建任务 → 无证据声明完成 → 跑命令 → 记录证据 → 完成 | 证据闸门在复验阶段之前就拒绝了声明 |
| `budget-resume` | 建带交接说明的任务 → 耗尽步数预算 → 自动续跑 → 取证并完成 | 预算停止会转变为从持久状态继续 |
| `crash-resume` | 种子日志的最后一轮未关闭 → 恢复 agent → 自动续跑 → 完成 | 修复路径把尾部标记为 `interrupted`，工作得以继续 |

## 运行

```sh
cd deepseek-harness
pnpm run build:bench
pnpm exec vitest run --config vitest.bench.config.ts benchmarks/long-task-acceptance/long-task-acceptance.bench.ts
```

每个场景输出一行 JSON：

```json
{"scenario":"budget-resume","ok":true,"turns":2,"resumes":1,"budgetStops":1,"totalMs":54}
```

## CI 判据

只看 `ok`、`turns`、`resumes`、`budgetStops`。刻意不设时间预算：要回答的是机制是否触发，而墙钟阈值会让门禁在不同机器上抖动。`totalMs` 只记录用于诊断。

## 如何读失败信息

- `task status active` —— 完成闸门拒绝了最后一次声明，或脚本回复在任务完成前用尽。
- `turns N != M` —— 多驱动了一轮（本该续跑时没有续，或反之），或某一轮根本没有开启。
- `resumes N != M` —— 续跑守卫拒绝了，通常是因为任务没有交接说明，或 goal 处于 armed 状态。
- `budgetStops N != M` —— 步数上限设得高于或低于该轮实际消耗。

## 已知限制与延后工作

- **只用脚本化模型**——真实模型成功率属于另一类基准，此处不度量。
- **固定 shell**——`bash` 工具总是退出 0，因此基准证明的是接线，而不是命令语义。
- **场景不含压缩**——续跑与压缩 checkpoint 的交互由 task-state 的压缩存活测试覆盖。
