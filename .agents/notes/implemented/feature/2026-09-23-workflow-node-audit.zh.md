# Agent Note：工作流节点级运行审计

Status: implemented

[English](2026-09-23-workflow-node-audit.md) | 中文

## Problem

工作流运行之前只有子 agent 生命周期事件，无法说明哪个可视化节点正在运行、耗时多久、是否被跳过，或哪个有界的输入／输出摘要导致了失败。

## Decision

新增经过校验的 `workflow/node-start` 与 `workflow/node-end` 生命周期事件。编译器会在每个可视化节点前后发出事件，包括未选中分支的显式 `skipped` 状态，以及依赖波次失败后下游节点的 `blocked` 状态。绑定只对受信任的编译器可视化运行启用，普通模型编写的工作流脚本无法伪造节点审计记录。PTC guest 会限制摘要大小，Host 负责校验，并在取消时结束仍活跃的节点。Session Controller 会持久化经过脱敏且有上限的审计轨迹，其中包含运行 correlation id，并通过 `WorkflowRemoteRunView` 暴露；编辑器调试流会显示节点生命周期更新。

## Alternatives considered

从子 Agent 事件推断节点状态无法区分图节点和阻塞波次；持久化不受限的输入输出会突破审计数据的大小与脱敏边界，因此均未采用。

## Consequences

运维人员可以关联运行、波次、节点、重试预算、耗时、结果和有界摘要，同时不会保存密钥或无界 payload。不变式会拒绝重复、未配对、格式错误和未结束的节点生命周期。既有的 agent 生命周期与运行历史保持兼容。

## Validation

Workflow invariant、guest、PTC、Session Controller 与 UI 编译器测试通过。Workflow、Workflow PTC、Session Controller 和 UI Layout TypeScript 检查通过；生成的 guest 源码保持最新。
