# Agent Note: Use the local decision model only for tool discovery ranking

Status: implemented

English | [中文](2026-09-29-tool-discovery-decision-model.zh.md)

## Problem

Large native-tool catalogs need semantic capability matching, but replacing authorization or execution controls with an advisory model would make tool use dependent on an untrusted service and could widen permissions.

## Decision

`@deepseek-ai/dsh-tool-discovery` accepts an explicit `decisionModel` configuration and sends permission-filtered capability candidates to `POST <url>/decide`. The endpoint returns a typed `capability` choice with confidence and optional probabilities; accepted candidates are loaded through the existing discovery result and become visible only after the durable tool result is committed.

The decision model is advisory and bounded by `timeoutMs`, `candidateLimit`, `searchLimit`, and `resultMaxBytes`. Exact-name matching remains deterministic. Invalid responses, low-confidence choices, timeouts, and network failures use lexical ranking. Existing tool restrictions, approvals, parameter validation, execution timeouts, and concurrency limits remain authoritative and are never delegated to the model.

## Alternatives considered

**Use the decision model for approval or execution policy.** Rejected because model output is not an authorization source and an outage or prompt manipulation must not change the caller's permissions.

**Replace lexical discovery unconditionally.** Rejected because local services can be unavailable, slow, or miscalibrated; deterministic fallback keeps discovery usable and reproducible.

**Send the complete catalog to the endpoint.** Rejected because candidate bounds are part of the prompt and latency budget, and permission filtering must happen before model input.

## Consequences

Chinese or otherwise non-lexical capability requests can use the locally hosted decision model when a preset opts in. Each such search adds a bounded local request and may load a different set of schemas, with the associated prompt-cache and latency cost. The standard and diaosi shipped presets opt in to `http://127.0.0.1:8000`; the service is started separately by `scripts/start-decision-model.sh`, and an unavailable service falls back to lexical ranking.

## Validation

Tool discovery behavior tests cover typed ranking, lexical fallback, durable activation, permission filtering, and bounded catalog restoration. The package TypeScript check passes.
