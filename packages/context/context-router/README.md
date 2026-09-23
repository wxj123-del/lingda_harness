---
description: "Deterministic request-context routing for bounded model snapshots."
kind: "package-reference"
---

# @deepseek-ai/dsh-context-router

English | [中文](README.zh.md)

## Summary

`dsh-context-router` keeps the append-only Session log intact while selecting a bounded model-visible request snapshot. It classifies the latest user request as `fresh`, `recent`, `task`, or `full`, preserves system messages and the current user message, and never sends an orphan tool result without its tool call. Each decision also records a machine-readable signal such as `explicit-full`, `co-reference`, `follow-up`, `lexical-match`, `open-turn`, or `unrelated`, so diagnostics can distinguish why a route was chosen instead of treating all `task` routes as equivalent. While a turn is open, every later model step prioritizes that turn's tool working set; if the token budget is exceeded, older working-set units are trimmed atomically before older-turn history. Lexical routing only applies across completed turns.

## Use

The base bundle mounts this plugin globally. Its defaults retain 16 recent messages, up to 32 task-related messages, and at most 24,000 estimated tokens per request. `fresh` removes old ordinary conversation history; `task` adds older messages sharing request terms; `full` retains the complete history subject to the token budget. The durable log is never deleted or rewritten.

When `personal-agent` is mounted as well, the router reads the active mode's `maxContextTokens` as an upper bound. personal-agent no longer applies a second history or token-budget trim; it continues to clip tool results and mark duplicate context, so each request has one history selector and one budget authority.

```yaml
- name: '@deepseek-ai/dsh-context-router'
  config:
    recentMessages: 16
    taskMessages: 32
    recallMessages: 8
    pluginContextRatio: 0.25
    maxTokens: 24000
    safetyMarginTokens: 256
```

Each request records a `context/router` audit event with the selected scope, reason, message counts, estimated message input, `estimatedRequestTokens` including tool schemas, `estimatedWindowTokens` including the reserved output budget, final message budget, and bounded per-message type, token, and preview metadata. The metadata includes at most 128 messages, keeps only truncated previews, and does not duplicate complete message bodies; the omitted count is recorded separately. When the Session has recorded the provider `contextWindow`, output `maxTokens`, and tool schemas, the router subtracts output and schema reservations from the model window before selecting messages, preventing the fixed budget from overflowing smaller models. The audit separately records `requestOverflowTokens` when the full request envelope (messages, schemas, and reserved output) still exceeds the provider window. If required messages such as the system prompt, current request, or durable checkpoint already exceed the effective budget, the event records `budgetExceeded` and `overflowTokens`, and the UI shows a warning; the router does not drop those invariants just to satisfy the numeric limit. The event is diagnostic and does not become model context. When the provider runtime projects file or image blocks before adapter dispatch, it appends a bounded `finalPayload` audit with the projected message previews and projection flags, so the context preview can distinguish the routed snapshot from the adapter-ready payload; the awaited request-ready checkpoint persists this audit before dispatch.

The `context/router` audit also records the machine-readable route signal, allowing the UI and diagnostics to distinguish explicit requests, co-reference, follow-ups, lexical matches, open turns, and unrelated queries even when they share the same broad scope.

Message and tool-schema estimates use the same public heuristic as `token-meter`, so routing decisions and the Token trajectory display share one accounting rule. Within a process, estimates for immutable message and request-header objects are memoized, avoiding repeated pricing of the same long tool chain across selection and audit passes. Passive plugin or retrieval context is capped at 25% of the message budget by default; context belonging to the active open turn is exempt from this secondary cap and remains subject to the overall budget. Set `pluginContextRatio` between 0 and 1 to tune that bound.

When a provider advertises a context window, `safetyMarginTokens` reserves headroom for provider framing and tokenizer differences before selecting messages. The default is 256 tokens and the reserve is visible in the audit and Token trajectory UI. After a provider reports prompt usage for a settled or failed attempt, the router stores at most 16 recent provider/model deltas in a durable `context/calibration` event; a positive underestimate increases the next bounded reserve by up to 1.25x, capped at 4,096 tokens. This calibration is route-specific, survives restart, and never changes the durable transcript. Audits distinguish the heuristic estimate, applied reserve, most recent provider input, and sample count.

Co-reference wording such as `it`, `它`, `前面提到的方案`, and `这个文件` uses a bounded local recall window around the latest prior user turn. The default window is 8 messages; it does not call an embedding model or another LLM.

Short acknowledgements or continuation commands such as `好的`, `收到`, `明白了`, and `按这个来` stay attached to the recent task instead of being classified as a fresh topic merely because they contain no task keyword. When durable task lifecycle events are available, a continuation also recalls the latest prior task's model-visible messages and records its `taskId` and recall count in the router audit. The recall is bounded by `taskMessages`, so a short acknowledgement cannot silently expand into the entire prior task transcript.

For `recent` and `task` routes, the latest durable compaction checkpoint is retained even when it falls outside the message-count tail. An explicit `fresh` route still excludes it, so a declared topic switch does not inherit old task memory.

An open tool turn is recovered from durable `turn/start` and `user/message` events when the router process restarts, so a resumed step can still identify the active working-set boundary instead of relying only on in-memory state.

Durable task recall uses a per-Session incremental index. The first lookup replays the existing event log for restart safety; later requests fold only events appended after the index watermark, so a short follow-up does not repeatedly scan a 50K-event transcript. `turn/end` closes the active message association while task lifecycle records remain available for later continuation recall.

Task-term matching reuses the same bounded inverted index. Ordinary short requests only scan the bounded recent-user window, and historical task matching does not re-tokenize the full transcript on every request. Each term keeps at most the newest 256 message candidates; high-frequency terms that hit the cap fall back to an exact scan, and the complete durable log remains unchanged.

## Model Experience

### Routed request context

#### What the model sees

The model receives the system prompt, current user message, and the routed history selected for that request. A simple new turn uses the `recent` scope; a continuation within an open turn keeps its tool working set, while a later-turn task continuation can recover matching older history; an explicit `full` request keeps older messages within the token budget. Under pressure, task-bearing user messages and model output take priority over passive plugin context; open-turn tool call/result units still take priority over older turns. When an active unit cannot fit in the remaining budget, the router does not backfill with smaller messages from older turns. The full Session transcript is not automatically sent.

#### Token effect

The default router bounds each request to 24,000 estimated tokens and leaves the complete durable Session log unchanged.

#### KV Cache effect

Changing the selected history can reduce the reusable prefix for that request. The router does not rewrite prior messages or compaction records.

## Known Limitations and Deferred Work

Routing is deterministic and local. It does not use embeddings or a second model call; semantic recall beyond explicit references, recency, and shared terms remains a later extension.
