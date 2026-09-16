# Agent Note: Budget-conscious Agent preset

Status: implemented

English | [中文](2026-09-16-diaosi-agent-preset.zh.md)

## Problem

Broad searches and repeated whole-file reads accumulate tool output that is resent on later model requests. Users need a selectable everyday mode that bounds this growth without replacing their chosen model or removing file editing and Skills.

## Decision

The shipped `diaosi` preset appears as 屌丝模式 in Chinese and Budget mode in English. It composes existing scoped tools and output policies, rather than adding a global optimizer. Its persona requests targeted searches, incremental reads and reuse of unchanged passages still available in context. Project instructions, Host permissions, sandboxing and model routing retain their existing owners.

The [preset composition](../../../../packages/preset/agent-presets/presets/diaosi/agent.cordis.yml) configures file-read and search limits directly because generic spill handling excludes `read`. Generic text results use the Host's shared spill policy and backend, while a private compaction group trims old results before summarizing and triggers earlier relative to the selected model's context window. The Host token meter remains shared because both services are process-wide infrastructure.

## Alternatives considered

**A prompt-only preset.** Guidance cannot enforce output limits, so tool-owned caps accompany it.

**A global optimization plugin.** It changes other presets and requires new routing or deduplication behavior. The existing composition system provides an explicit per-session choice with fewer moving parts.

**Change the selected model automatically.** Provider price and capabilities are user choices; the preset keeps the configured route.

## Consequences

The smaller static catalog omits delegation, workflows, goals and plan-mode tools. Tasks requiring those capabilities use another preset in a new conversation. Limits can require more paginated reads, and earlier summaries can cost tokens and lose detail. No fixed total token ceiling, automatic duplicate-read cache, task-dependent tool selection or measured savings percentage is provided. Required verification still takes priority over minimizing output.

Unit tests cover discovery and bilingual labels. Real Web composition coverage exercises the selected model identity, scoped reads, search caps, generic spill previews and compaction isolation, with a persona snapshot. Browser coverage records the picker and verifies selection survives a reload. Provider-dependent compaction quality and end-to-end token savings are not measured by these keyless checks.
