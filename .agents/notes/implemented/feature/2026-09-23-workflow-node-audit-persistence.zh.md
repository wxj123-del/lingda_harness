# Agent Note: Incremental workflow node audit persistence

Status: implemented

[English](2026-09-23-workflow-node-audit-persistence.md) | 中文

## Problem

每次节点开始和结束都持久化完整工作流视图，会重复写入运行结果，并且历史体积会随着节点数量和摘要大小增长。

## Decision

Session Controller 会为每次经过校验的节点审计更新追加一个 `visual-workflow/node` 事件。运行开始和终态仍使用完整的 `visual-workflow/run` 检查点。冷恢复时会把增量节点事件折叠到最新运行检查点，同时兼容已经包含完整审计数组的旧检查点。

## Alternatives considered

**每个节点继续写入完整运行检查点：** 否决，因为重复的运行元数据和摘要会不必要地占用持久化历史。

**只持久化终态运行检查点：** 否决，因为运行中或被中断的运行会丢失诊断所需的节点时间线。

## Consequences

运行中的审计仍从内存提供，持久化历史只记录有界的节点更新，不再重复保存运行结果。`visual-workflow/node` 事件带有可忽略标记，因此不了解这个辅助记录的旧读取器仍可保留对话历史。恢复逻辑继续兼容已有的 `visual-workflow/run` 审计数组。

## Verification

Session Controller 测试覆盖冷持久化运行上折叠节点开始／结束事件，并断言实时节点更新不会创建额外的完整运行检查点。Host TypeScript 编译通过。
