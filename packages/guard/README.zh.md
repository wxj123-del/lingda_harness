---
description: "循环卫生 guard 家族的包映射：建议性重复工具提醒、单次工具调用超时策略与运行时轮次预算，供选择或组合 guard 的用户与维护者阅读。"
kind: "package-group"
---

# guard/：循环卫生 guard 家族

[English](README.md) | 中文

## 概述

`guard/` 组通过监视四种失败模式来保持 agent loop（智能体循环）高效。`repeat-tool-reminder` 会在模型重复完全相同的工具调用时提醒它改变方法或结束任务，让卡住的循环不再浪费时间和 token。`timeout-policy` 为声明了限时的工具调用设置时间上限，让挂起的调用向模型返回清晰的超时错误，而不是拖住整个会话。`budget-guard` 通过步数、token、墙钟时间与会话轮数约束整个轮次，超限时在步骤边界终止并留下持久记录。`auto-resume` 把这种停止变成继续：任务仍然活动且有交接说明时，它排队下一轮而不必等人推动。四者都在 `dsh` 基础组合包中挂载；组合可以调优或移除它们。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

下文每个 README 都说明何时保留、调优或移除该插件。

| 包 | 提供什么 |
|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.zh.md) | 在模型重复完全相同的工具调用时提醒它，使其改变方法或结束任务 |
| [`timeout-policy/`](timeout-policy/README.zh.md) | 为声明了限时的工具调用设置超时，让模型得到清晰错误而不是无限等待 |
| [`budget-guard/`](budget-guard/README.zh.md) | 步数、token、墙钟或轮次预算耗尽时在步骤边界终止失控轮次 |
| [`auto-resume/`](auto-resume/README.zh.md) | 预算停止或崩溃中断后，对有交接说明的活动任务自动续跑，且次数有上限 |

-----

<a id="related-documentation"></a>
## 相关文档

先从工具子系统参考了解工具调用流水线，再看重复提醒的配置与策略背后的超时库决策。

- [工具子系统参考](../../docs/subsystems/tools.zh.md)——两个 guard 都依赖的工具调用流水线与决策。
- [生成配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-repeat-tool-reminder)——重复调用提醒的每个受支持字段。
- [超时截止时间库 Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.zh.md)——`timeout-policy` 所执行的时序／终止拆分。
- [长任务持久化 Agent Note](../../.agents/notes/implemented/feature/2026-10-19-long-task-durability.zh.md)——为什么轮次预算与任务快照并存。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
