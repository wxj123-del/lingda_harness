# Agent Note: 模型驱动的对话框提示词优化

Status: implemented

[English](2026-09-29-composer-prompt-optimizer.md) | 中文

## Problem

DSH 对话框接受自由输入，但用户经常需要在发送前补充目标、上下文、约束和输出要求。此前没有就地整理草稿的辅助功能，浏览器也没有通过当前 Session 选中模型改写草稿的操作。

## Decision

在对话框工具栏增加提示词优化按钮，打开可编辑的优化面板。面板把当前草稿和通用、代码开发、写作或分析模式发送给新的 Session Controller Remote。Host 使用 Session 当前选中的 provider/model 通过辅助 `ctx.llm.stream()` 调用模型，不携带 `sessionId` 也不写入 Session event，只返回文本。用户可以继续编辑结果、复制结果，或通过 `InputActions.setDraft` 应用回现有草稿。空草稿、斜杠命令以及锁定或提交中的输入禁用按钮；关闭、切换模式和卸载时取消进行中的请求，失败状态可以重试。

## Alternatives considered

**使用确定性的浏览器模板。** 不采用，因为这无法提供用户要求的 AI 优化，也不能根据用户实际意图调整提示词。

**点击图标后立即改写草稿。** 不采用，因为用户应先查看并编辑候选文本，再决定是否把它变成将要发送的消息。

## Consequences

优化是异步的，并受当前 provider/model 可用性影响；用户应用前仍可编辑或放弃结果。辅助调用不属于 Session transcript，只有用户明确应用后结果才成为普通用户草稿。Host 负责模型选择、输入长度限制、取消、输出校验以及抵抗草稿内提示注入的系统指令。
