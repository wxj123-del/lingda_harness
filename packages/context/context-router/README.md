---
description: "Deterministic request-context routing for bounded model snapshots."
kind: "package-reference"
---

# @deepseek-ai/dsh-context-router

English | [中文](README.zh.md)

## Summary

`dsh-context-router` keeps the append-only Session log intact while selecting a bounded model-visible request snapshot. It classifies the latest user request as `fresh`, `recent`, `task`, or `full`, preserves system messages and the current user message, and never sends an orphan tool result without its tool call. While a turn is open, every later model step prioritizes that turn's tool working set; if the token budget is exceeded, older working-set units are trimmed atomically before older-turn history. Lexical routing only applies across completed turns.

## Use

The base bundle mounts this plugin globally. Its defaults retain 16 recent messages, up to 32 task-related messages, and at most 24,000 estimated tokens per request. `fresh` removes old ordinary conversation history; `task` adds older messages sharing request terms; `full` retains the complete history subject to the token budget. The durable log is never deleted or rewritten.

```yaml
- name: '@deepseek-ai/dsh-context-router'
  config:
    recentMessages: 16
    taskMessages: 32
    maxTokens: 24000
```

Each request records a `context/router` audit event with the selected scope, reason, message counts, and estimated input tokens. The event is diagnostic and does not become model context.

## Model Experience

### Routed request context

#### What the model sees

The model receives the system prompt, current user message, and the routed history selected for that request. A simple new turn uses the `recent` scope; a continuation within an open turn keeps its tool working set, while a later-turn task continuation can recover matching older history; an explicit `full` request keeps older messages within the token budget. The full Session transcript is not automatically sent.

#### Token effect

The default router bounds each request to 24,000 estimated tokens and leaves the complete durable Session log unchanged.

#### KV Cache effect

Changing the selected history can reduce the reusable prefix for that request. The router does not rewrite prior messages or compaction records.

## Known Limitations and Deferred Work

Routing is deterministic and local. It does not use embeddings or a second model call; semantic recall beyond explicit references, recency, and shared terms remains a later extension.
