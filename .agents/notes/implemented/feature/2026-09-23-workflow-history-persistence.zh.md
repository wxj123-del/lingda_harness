# Agent Note：可视化工作流运行历史持久化

Status: implemented

[English](2026-09-23-workflow-history-persistence.md) | 中文

## Problem

工作流运行历史之前只存在于 Session Controller 进程内。Host 重启后已完成的运行会丢失，状态和列表接口也无法从持久化 Session 恢复运行记录。

## Decision

Host 在可视化工作流启动时追加一条 `visual-workflow/run` 检查点，在工作流结束时再追加最终检查点。`workflowList` 从当前附着的 Session 或冷读取的 Session 日志中恢复每个运行的最新检查点，再以内存中的实时记录覆盖持久记录，最后执行过滤、排序和数量限制。`workflowStatus` 可以读取已持久化的终态运行；对于不再运行的记录，取消操作会拒绝执行。

该事件已注册到 Session 持久化目录，存储的就是 Remote API 已经暴露的脱敏运行视图。输入只记录字节数，不保存输入内容。

## Alternatives considered

只在 Session Controller 内保存历史会在 Host 重启后丢失；持久化原始输入或完整运行负载会保留秘密并造成无界数据，因此均未采用。

## Consequences

Host 重启后仍能查看运行历史，并且无需激活 Session Agent。运行期间以内存实时状态为准，持久化检查点提供可恢复的最终状态。恢复辅助函数会忽略旧格式或格式错误的事件，避免将无效 Remote 数据暴露给客户端。

## Validation

Session Controller Host/Client TypeScript 检查、Remote Host/Client TypeScript 检查、持久化目录校验，以及 Session Controller、工作流编译器和工作流面板的聚焦测试均通过。聚焦测试共通过 27 个用例。
