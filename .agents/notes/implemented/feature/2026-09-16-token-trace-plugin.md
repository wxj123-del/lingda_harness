# Agent Note: Optional per-attempt Token trace

Status: implemented

English | [中文](2026-09-16-token-trace-plugin.zh.md)

## Problem

The ordinary trajectory focuses on content and timing. Users need every recorded model attempt and its input sources alongside provider usage, including failed attempts that never produce a visible assistant message.

## Decision

An optional `dsh-client-ui-step-insight` bundle shadows the `trajectory` conversation view through slot priority. It consumes the existing Session event window through a private renderer hook and keeps the original trajectory target owner mounted. Unloading the plugin restores the previous view. Installation changes no shipped defaults, model prompt or persistence format.

Provider usage and content estimates remain separate. Missing cache fields never become zero. A complete consistent provider total is exact; otherwise the sum of known fields is a labelled lower bound. Reasoning remains a subset of output. Each durable attempt is a distinct row, live usage checkpoints replace rather than accumulate, and a durable settlement supersedes the temporary stream. Compaction usage has its own row. Input inspection applies surface replacements and records sequence references, but does not invent custom message projections or compaction prompts.

Tool schemas display local lexical similarity to the selected request's retained user text, defaulting to the latest user message. Distinct terms and IDF-weighted cosine comparison keep repeated words from inflating relevance; a limited Chinese/English task vocabulary bridges common requests and English descriptions. Only tool names and descriptions participate. The view exposes reference messages, matching terms, actual calls, and optional descending order independently of Token estimates. No text is sent to another model.

## Alternatives considered

**Extend the existing trajectory record layout.** Its step-oriented assistant state is insufficient to preserve each failed attempt independently. The optional replacement can consume durable attempts without changing other consumers.

**Attribute an exact share of provider input to every message.** Providers return aggregate counters without per-message tokenization. Proportional allocation would look precise without evidence; the plugin instead exposes text estimates and the original aggregate.

**Use an embedding or extra model for relevance.** This adds model configuration, latency and potentially billable usage to inspecting usage. The user selected local text comparison, with visible estimate labels and matching evidence instead of a semantic-confidence claim.

## Consequences

The view accounts only for loaded history. Child Sessions and auxiliary calls without usage events are excluded explicitly. Tool results can be inspected in every later request retaining them, but tool execution and PTC internal results never create extra provider charges. Full source records remain exportable.

The existing [composer statistics decision](2026-09-07-composer-session-stats-pills.md) remains authoritative for full-session totals; this note does not supersede it. The [conversation assembly decision](../architecture/2026-08-09-client-conversation-node-assembly.md) continues to own targets and registrations.

## Validation

Focused tests cover cache accounting, missing fields, retries, transient settlement, interruption, compaction, source replacements, paging, interaction and disposal. The keyless browser scenario loads the real composition with the optional overlay and an existing recorded Session, exercises search, inspection and export, and checks desktop and mobile rendering.

Similarity tests cover Chinese and English tasks, irrelevant and absent text, repeated terms, excluded content, historical cutoffs and replacements, ordering, reference selection, and actual-call labels. The browser scenario supplies concrete schemas for the recording's schema placeholder and checks visible relevance controls, match evidence, and narrow-screen layout while retaining the original provider accounting.
