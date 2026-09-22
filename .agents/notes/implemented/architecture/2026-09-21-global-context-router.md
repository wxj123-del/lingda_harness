# Agent Note: Global context router

Status: implemented

## Problem

The durable Session surface can grow through long tasks, while a simple new question does not need every prior user, assistant, and tool message in its next model request.

## Decision

The base composition mounts `@deepseek-ai/dsh-context-router` on the shared `agent/request-context` waterfall. The router selects a request snapshot after other context listeners have run. At the first step of a turn it uses deterministic request wording to choose `fresh`, `recent`, `task`, or `full`; later steps prioritize the open turn's working set before older history. If the token budget is exceeded, older working-set units are trimmed atomically before older-turn history. System messages and the latest user message remain mandatory, and tool calls and results are retained or discarded as pairs. The append-only Session log remains the source of truth; each selection records a diagnostic `context/router` event.

## Alternatives considered

**Embedding retrieval first:** deferred because it adds an index, model/provider dependencies, and non-deterministic ranking before the basic request-snapshot contract is validated.

**Deleting or compacting Session history at routing time:** rejected because it would make replay and audit depend on the wording of a later request. Compaction remains a separate durable operation.

## Consequences

Simple questions now use a bounded recent snapshot, explicit task continuations can recover older keyword-matching messages, and complete-history requests remain available within the configured budget. A multi-step tool task no longer gets reclassified as a fresh request at every model call. Routing is intentionally lexical and conservative; semantic retrieval and richer task-memory indexing remain future work.
