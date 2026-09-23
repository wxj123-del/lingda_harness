# Agent Note: Bounded local reference recall in context routing

Status: implemented

English | [中文](2026-09-23-context-local-reference-recall.zh.md)

## Problem

Keyword routing cannot connect short co-reference requests such as `它现在能用了吗` or `前面提到的方案` to the earlier turn that established the subject.

## Decision

The router recognizes a small, explicit co-reference vocabulary locally and routes those requests to `task`. It recalls a bounded window beginning at the latest prior direct user message, with `recallMessages` defaulting to 8. The recall window is added before the normal token budget pass and remains subject to tool-pair closure and the unified estimator. No embedding model or extra LLM call is used.

## Alternatives considered

**Treat every short Chinese request as a task continuation.** Rejected because generic requests such as `这个问题怎么解决` would reattach unrelated history.

**Use an embedding service for every ambiguous request.** Deferred because it adds latency, model state, and a new failure mode to the request path before a durable recall index exists.

**Recall the entire prior turn.** Rejected because a prior turn can contain a large tool chain and would bypass the router's bounded-context goal.

## Consequences

Common co-reference requests recover their immediately preceding subject without requiring the user to repeat project terms. The vocabulary is intentionally conservative; uncommon or genuinely semantic references still fall back to the existing recent/fresh behavior. `recallMessages` is configurable and its selected messages appear in the existing route audit.

## Verification

The context-router, personal-agent, and token-meter focused suites pass 57 tests, and TypeScript project checks pass for all three packages.
