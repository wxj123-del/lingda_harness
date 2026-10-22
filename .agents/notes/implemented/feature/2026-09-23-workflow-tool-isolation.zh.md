# Agent Note：工作流工具隔离

Status: implemented

[English](2026-09-23-workflow-tool-isolation.md) | 中文

## Problem

可视化 `tool` 节点之前只是普通的模型提示词。子 agent 可以看到无关工具，因此节点中配置的工具只是描述信息，而不是可执行的能力边界。

## Decision

为工作流 `agent()` 增加经过校验的 `toolFilter` 选项，并让它贯穿 PTC guest、生成的 guest 源码、Host 回调边界和 Subagent 启动请求。可视化编译器会为每个工具节点生成 `{ allow: [configuredTool] }`，没有配置工具时拒绝编译。子 agent 提供方仍负责检查工具是否存在，并把限制同时应用为提示词可见性和执行权限。

## Alternatives considered

只依赖 prompt 文案无法形成执行权限；把完整全局工具目录授予每个子 Agent 又违反配置的工具边界，因此均未采用。

## Consequences

工具节点现在以最小权限运行，不能意外向子 agent 暴露全局工具目录。提供方能力不足或工具不存在时会作为工作流错误呈现。这是受约束的原生工具路径；HTTP、代码和知识库节点仍需要各自的 Host 服务，暂时不能宣称具有同等的直接执行能力。

## Validation

Workflow PTC guest、Host、引擎和 UI 编译器测试通过 114 个用例。工作流 guest 生成校验、PTC TypeScript、UI Layout TypeScript 和工作流 README 翻译配对检查通过。
