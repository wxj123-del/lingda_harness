# Agent Note: Budget-conscious Agent preset

Status: implemented

English | [中文](2026-09-16-diaosi-agent-preset.zh.md)

## Problem

Broad searches and repeated whole-file reads accumulate tool output that is resent on later model requests. Users need a selectable everyday mode that bounds this growth without replacing their chosen model or removing file editing and Skills.

## Decision

The shipped `diaosi` preset appears as 屌丝模式 in Chinese and Budget mode in English. It composes existing scoped tools and output policies, rather than adding a global optimizer. Its persona requests targeted searches, incremental reads and reuse of unchanged passages still available in context. Project instructions, Host permissions, sandboxing and model routing retain their existing owners.

The [preset composition](../../../../packages/preset/agent-presets/presets/diaosi/agent.cordis.yml) configures file-read and search limits directly because generic spill handling excludes `read`. Its scoped spill policy limits shell, search, web and job-output text to 8,000 bytes including retrieval guidance, using the shared backend. Scoped policies run before Host bounding so the saved artifact contains the original formatted result. A private compaction group trims old results before summarizing and triggers earlier relative to the selected model's context window. The Host token meter and spill backend remain shared process-wide infrastructure.

The shorter persona encourages direct answers to simple questions and concise replies without repeated logs or plans. These are model instructions, not hard output limits. Compact Skill catalogs shorten guidance while preserving names, descriptions, loading rules and full instruction bodies. An unchanged catalog is not republished just because its style changed; existing history remains intact. Project and permission instructions are not shortened.

The scoped [tool-discovery plugin](../../../../packages/preset/tool-discovery/README.md) starts with four tools plus search, ranks historical actual calls, and loads at most two relevant tools per search. This also filters inherited Host media schemas. Selection is bounded to eight tools plus search and restored from existing request headers and committed result metadata; the loop and execution permissions are unchanged. Exact names load one tool, and unmatched queries never dump the catalog.

## Alternatives considered

**A prompt-only preset.** Guidance cannot enforce output limits, so tool-owned caps accompany it.

**A global optimization plugin.** It changes other presets and requires new routing or deduplication behavior. The existing composition system provides an explicit per-session choice with fewer moving parts.

**Change the selected model automatically.** Provider price and capabilities are user choices; the preset keeps the configured route.

## Consequences

The preset omits delegation, workflows, goals and plan-mode plugins. Tasks requiring unregistered capabilities use another preset in a new conversation. Output limits can require more paginated reads, and earlier summaries can cost tokens and lose detail. Tool discovery can add a model round and invalidate cached prefixes when schemas change. No fixed total token ceiling, automatic duplicate-read cache or measured billing savings percentage is provided. Required verification still takes priority over minimizing output.

Unit tests cover discovery and bilingual labels. Real Web composition coverage exercises the selected model identity, scoped reads, search caps, generic spill previews and compaction isolation, with a persona snapshot. Browser coverage records the picker and verifies selection survives a reload. Provider-dependent compaction quality and end-to-end token savings are not measured by these keyless checks.

The keyless `skill-compact` session snapshot preserves compact catalog text and full Skill loading through the shipped headless profile. Web request checks compare both catalog styles and preserve project and permission context. Scoped spill tests verify full-result storage, Host mounting order and disposal; standard sessions retain the Host limit.

Tool-selection tests cover frequency ranking, scoped execution denial, bounded search, commit-only activation, disposal, cancellation and log restoration. A real Loader/Web composition runs a scripted model through search and media execution, checks recorded headers against actual requests, and snapshots the catalog changes and tool results. The image fixture does not call an image provider.
