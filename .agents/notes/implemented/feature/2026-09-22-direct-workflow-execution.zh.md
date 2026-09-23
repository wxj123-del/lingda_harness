# Agent Note：可视化工作流直接执行

Status: implemented

[English](2026-09-22-direct-workflow-execution.md) | 中文

## Problem

可视化工作流编辑器可以保存和检查画布，但测试操作仍然会打开聊天并依赖模型选择工作流工具。执行路径不直接，运行归属不清晰，编辑器也无法报告由 Host 持有的运行状态。

## Decision

Session Controller 暴露 `workflowStart`、`workflowCancel`、`workflowStatus` 和 `workflowList` Remote 方法。启动请求会解析目标 Session Agent，把保存的画布编译为现有 `dsh-workflow` 脚本协议，并记录有界、JSON 安全的运行视图，同时处理超时、取消、释放和 Session 销毁。工作流生命周期事件加入 Remote 转发白名单。

浏览器端 Session 接口直接调用这些方法。编辑器的测试操作只保存一次草稿，编译并启动运行，不再创建聊天提交。调试台通过 `ctx.remote.$on` 监听，只显示当前工作流的生命周期事件。编译后的提示词只保留凭据引用名，密钥值不会进入画布或运行视图。

## Alternatives considered

**继续通过聊天提示词路由。** 放弃，因为执行仍由模型决定，编辑器无法负责取消运行，模型拒绝也无法与工作流失败区分。

**在 UI 包中重新实现工作流引擎。** 放弃，因为这会复制现有引擎的解析、子 Agent 生命周期、取消和资源策略。Session Controller 已经拥有 Host Agent 权限，是合适的 Remote 接口归属。

**在浏览器保存完整结果和凭据。** 放弃，因为工作流结果可能包含非 JSON 值，凭据材料必须由 Host 持有。Remote 视图只保存脱离引用的 JSON 值和凭据引用名。

## Consequences

编辑器可以独立于会话状态启动工作流，并拥有后续运行历史和重试界面所需的稳定控制接口。Host 内存中保留有限的近期运行记录，Session 或 Controller 销毁时会取消运行。当前编辑器仍以生命周期事件为主，而不是完整运行历史表；`workflowList` 已提供下一步 UI 增量所需的数据接口。

## Validation

Session Controller、Remote assembly 和 UI layout 的 TypeScript 程序均已编译。工作流面板客户端测试通过 11 个用例，其中包含直接运行路径；`git diff --check` 通过。
