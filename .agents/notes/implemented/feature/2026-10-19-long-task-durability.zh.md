# Agent Note：长任务持久化——任务状态、轮次预算与可恢复压缩

状态：已实现

[English](2026-10-19-long-task-durability.md) | 中文

## 问题

本 harness 中的长任务无法在自己的上下文中存活。三个缺口叠加成同一种失败模式。

`todos` 投影是按轮次级的工作记忆：每次 `turn/start` 都返回 `null`。多轮任务因此没有持续清单，除非模型每轮重写整个列表；也没有任何地方记录哪些验收条件真正被证明过。

核心循环没有步数、轮数、token 或墙钟上限。唯一的约束是 personal-agent 的模式步数上限与 `defaultMaxGoalRounds`；两者都只计迭代次数而不计成本，且未挂载 personal-agent 的组合根本用不到。

压缩只产出一段扁平摘要。后续压缩会再摘要先前的摘要，细节随每次压缩退化，且无法回读原始内容。checkpoint 也没有固定的文件、验收条件或证据小节，这些事实只有摘要模型自愿保留时才存在。

## 决策

**持久任务状态。** `dsh-task-state` 注册一个最后写入生效的 `task` 投影，其 `task/state` 事件携带完整快照：目标、验收条件、证据记录、决策与交接说明。变更是纯函数（`applyTaskPatch`），因此规则无需会话即可测试。证据记录携带其覆盖的 1-based 验收序号，覆盖率只统计 `pass` 记录。只要任一验收条件缺少通过记录，标记任务 `succeeded` 就会被拒绝，这让“完成”成为被检查的声明，而不是模型断言。在每个顶层轮次的第 1 步，插件注入一张有界的插件来源卡片，重述目标、验收条件、未覆盖序号、最近失败与交接说明。由于卡片来自投影而非消息历史，它能跨越压缩：早先消息可以被遮蔽，目标仍能到达下一次请求。任务活动期间，已结算的 `bash`/`pwsh` 结果会带着真实退出码被记录为自动证据。

**轮次预算。** `dsh-budget-guard` 在 `agent/pre-step` 中评估步数、token、墙钟与会话轮数上限。超过上限即拒绝该步骤，因此该轮在边界处以 `blocked` 结束，不留下部分请求，并由一条 `budget/stop` 事件记录原因、上限与观测值。每项上限都需显式启用。在 `warnAtRatio` 处的一条建议性提醒要求模型写交接说明，与任务的 `handoff` 字段配对：下一轮从持久状态而非摘要恢复。

**可恢复压缩。** `compaction-basic` 新增可选的 `sidecar` 设置。启用后，每次摘要会写入按会话分离的私有文件，checkpoint 在 `<compaction-detail>` 块中给出其路径，因此后续压缩把该摘要折叠为更粗粒度摘要时，细节仍可回读。摘要指令新增四个固定小节：Files Touched、Acceptance Criteria and Evidence、Verification Evidence 与 Failed Attempts。

`dsh` 基础组合包启用 `task-state`，以全部上限未设置的方式挂载 `budget-guard`，并在 `compaction-basic` 上设置 `sidecar: true`。

## 备选方案

**只继续改进摘要提示词。** 已拒绝，因为摘要本身是有损的，重复摘要会累积损失；改用 sidecar 加投影，让事实保持可寻址，而不是寄希望于每段摘要都保留它们。

**让 `todos` 跨轮持久。** 已拒绝，因为该列表刻意是按轮次清单，整体替换且没有稳定标识；持久工作需要验收、证据与决策，那是另一种形态。

**在 agent loop 内强制预算。** 已拒绝，因为循环是所有组合共享的核心；guard 插件可按部署调优或移除，且现有的 `agent/pre-step` waterfall 已提供拒绝点。

**只在系统提示词中把关完成。** 已拒绝，因为提示词只是建议。拒绝必须发生在状态变更处，这样模型才能拿到具体的缺失序号列表。

## 影响

长任务现在能跨轮次与压缩携带目标、验收状态与证据，并能说明为何停止。代价是额外的模型可见上下文：一个工具 schema、一段提示词小节、每轮一张小卡片，以及每次压缩一个 sidecar 文件。证据是声明而非再次验证，因此除非来自自动 shell 观测，伪造记录不会被发现；报告将此记为主要残余风险。`budget-guard` 只在提供方上报 usage 时统计 token，因此未上报 usage 的尝试不会被计入。sidecar 是辅助而非前提：写入失败会记录警告，checkpoint 保持与引入 sidecar 之前一致。

验证：`packages/todo/task-state/tests` 覆盖纯变更、跨轮次边界与会话面替换的投影存活、卡片注入、自动证据以及压缩存活路径；`packages/guard/budget-guard/tests` 覆盖步数、token、轮数终止以及提醒；`packages/compaction/compaction-basic/tests/sidecar.spec.ts` 覆盖文件、权限与 checkpoint 引用。
