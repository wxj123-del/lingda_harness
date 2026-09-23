# Agent Note: 上下文路由中的有界本地指代召回

Status: implemented

[English](2026-09-23-context-local-reference-recall.md) | 中文

## Problem

关键词路由无法把“它现在能用了吗”“前面提到的方案”等简短指代请求关联到建立该主题的前一轮对话。

## Decision

路由器在本地识别一组明确的指代表达，并将这些请求路由到 `task`。它从最近一条直接用户消息开始召回有界窗口，`recallMessages` 默认值为 8。召回内容仍会经过工具调用配对和统一 Token 预算裁剪，不调用 embedding 模型或额外 LLM。

## Alternatives considered

**把所有简短中文请求都当成任务延续。** 否决原因：这样会把“这个问题怎么解决”等通用请求错误关联到旧历史。

**对每个有歧义请求调用 embedding 服务。** 暂缓原因：在持久召回索引建立之前，这会把延迟、模型状态和新的失败模式引入每次请求路径。

**召回整个上一轮。** 否决原因：上一轮可能包含很长的工具链，会绕过上下文路由的预算目标。

## Consequences

常见指代请求无需用户重复项目关键词即可找回紧邻主题。词表保持保守，少见或真正需要语义理解的表达仍会回退到现有的 recent/fresh 行为。`recallMessages` 可配置，召回结果会出现在已有路由审计中。

## Verification

context-router、personal-agent 和 token-meter 聚焦测试共通过 57 个用例；三个包的 TypeScript 项目检查通过。
