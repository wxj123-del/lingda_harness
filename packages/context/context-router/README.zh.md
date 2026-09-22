---
description: "按确定性规则路由请求上下文，生成有预算的模型快照。"
kind: "package-reference"
---

# @deepseek-ai/dsh-context-router

[English](README.md) | 中文

## 概述

`dsh-context-router` 保留追加式 Session 日志，同时为每次模型请求选择有界的可见快照。它把最新用户请求分类为 `fresh`、`recent`、`task` 或 `full`，始终保留系统消息和当前用户消息，并且不会发送缺少工具调用的孤立工具结果。一个 turn 尚未结束时，后续模型 step 会优先保留该 turn 的工具工作集；如果超过 token 预算，会先按原子工具单元裁剪较旧的工作集，再裁剪更早 turn 的历史。关键词路由只用于已结束 turn 之间的历史。

## 使用

`dsh-base` 会全局挂载本插件。默认每次请求保留最近 16 条消息，最多补充 32 条任务相关消息，并限制在估算 24,000 token 以内。`fresh` 会删除旧的普通对话历史；`task` 会补充与当前请求共享关键词的旧消息；`full` 会在 token 预算内保留完整历史。持久日志不会被删除或重写。

```yaml
- name: '@deepseek-ai/dsh-context-router'
  config:
    recentMessages: 16
    taskMessages: 32
    maxTokens: 24000
```

每次请求都会记录 `context/router` 审计事件，其中包含范围、原因、消息数量、估算输入 token 和最终消息预算。若 Session 已记录提供方的 `contextWindow`、输出 `maxTokens` 与工具 schema，路由器会先从模型总窗口中扣除输出和 schema，再选择消息，避免固定预算把小窗口模型推过上限。该事件只用于诊断，不会成为模型上下文。

## 模型体验

### 路由后的请求上下文

#### 模型能看到什么

模型会收到系统提示词、当前用户消息，以及本次请求路由选中的历史。新的普通 turn 使用 `recent` 范围；开放 turn 内的后续 step 会保留该 turn 的工具工作集，之后新 turn 的任务延续才会召回匹配的旧历史；明确要求完整历史时，则会在 token 预算内保留旧消息。完整 Session transcript 不会自动发送。

#### Token 影响

路由器默认把每次请求限制在估算 24,000 token 以内，同时完整保留持久 Session 日志。

#### KV Cache 影响

所选历史发生变化时，本次请求可复用的前缀可能减少。路由器不会重写旧消息或 compaction 记录。

## 已知限制与延期工作

路由规则是本地确定性的，不使用 embedding，也不会额外调用模型。除显式引用、近期性和共享关键词之外的语义召回，将在后续阶段扩展。
