# Agent Note：工作流运行控制台

Status: implemented

[English](2026-09-23-workflow-run-console.md) | 中文

## Problem

可视化工作流编辑器已经可以启动 Host 持有的运行，但还不能保留运行身份、输入真实测试参数、取消运行，也不能展示完成后的结果和近期历史。

## Decision

编辑器现在支持保存文本或 JSON 测试输入，把输入传给直接 Session 工作流启动接口，记录返回的 run id，轮询 Host 状态，并提供停止、重试、状态、耗时、Agent 数量、错误、JSON 安全结果和近期运行历史。Host 增加了输入大小校验，以及按 Session 和全局的并发运行上限。

## Alternatives considered

让运行 fire-and-forget 会无法检查或取消；由浏览器直接发送原始运行状态会绕过 Host 的归属、脱敏和并发限制，因此均未采用。

## Consequences

直接运行现在可以在工作流操作台内查看和控制，不需要离开编辑器。运行历史仍由 Host 持有并限制数量，浏览器只接收脱敏后的运行视图。默认空输入继续兼容现有运行回调。

## Validation

Session Controller 和 UI Layout TypeScript 检查通过。工作流面板客户端测试通过 12 个用例，其中包含输入传递和取消运行。Session Controller、Remote 和 UI Layout bundle 均通过。`git diff --check` 通过。
