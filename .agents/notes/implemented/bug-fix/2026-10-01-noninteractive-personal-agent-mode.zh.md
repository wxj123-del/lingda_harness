# Agent Note: 非交互式 profile 默认使用 execution 模式

Status: implemented

[English](2026-10-01-noninteractive-personal-agent-mode.md) | 中文

## 问题

共享 base profile 会让新的 Personal Agent Session 以 `qa` 模式启动。该默认值适合提供模式选择器的 Web，但 Headless 和 SDK 调用方在首次提示词前没有选择器。因此，这些 Session 不会向模型提供工具，并以 `MODE_TOOL_DENIED` 拒绝 profile 已组合的 `bash`、`subagent` 等执行工具。

## 决策

共享 base profile 保留 `qa` 作为交互式默认值。Headless 和 SDK 应用 patch 将 Personal Agent 的完整配置替换为默认使用 `execution`，并重复 base 的各模式步数上限，因为 Cordis patch 会替换插件的完整配置。新 Session 在首次提示词中即可使用这些非交互式 profile 组合的全部工具。沿用的 Session 继续使用其日志中已有的持久化 `agent/mode` 事件。

## 考虑过的替代方案

**使用 `coding` 模式。** 不予采用，因为 `coding` 有意省略 `subagent` 等工具；非交互式自动化必须提供其 profile 所组合的完整工具集。

**修改共享 base 的默认值。** 不予采用，因为 Web 用户拥有交互式选择器，并应保留更安全的直接回答默认值。

**要求每个调用方传入 mode 参数。** 不作为唯一修复，因为现有 Headless 和 SDK 调用方必须在没有新增必填字段时继续工作。未来仍可在 profile 默认值之上增加可选覆盖。

## 验证

Bundle 测试将每个非交互式覆盖与完整 base 策略比较，并要求只有 `defaultMode` 不同。无密钥 Headless 和 SDK profile 测试要求模型可见工具包含 `subagent`，Headless 测试还会执行真实的平台 shell 工具。配置验证会检查组合后的 profile 配置树。

## 后果

新的 Headless 和 SDK Session 会立即获得完整 execution 工具目录及 Personal Agent 的 `workspace-write` 权限 preset。已有的持久化模式选择继续作为权威状态。需要更窄无人值守策略的部署必须提供显式 profile patch，不能依赖交互式 `qa` 默认值。
