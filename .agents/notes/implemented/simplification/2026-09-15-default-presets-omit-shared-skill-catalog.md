# Agent Note: Default presets omit the shared skill catalog

Status: implemented

English | [中文](2026-09-15-default-presets-omit-shared-skill-catalog.zh.md)

## Problem

Default Web agents discovered every skill under the shared `<agentsHome>/skills` root and appended the complete catalog to the first model request. A user's unrelated global skills could therefore add thousands of prompt tokens before the agent had a task that needed them.

## Decision

`dsh-skill-filesystem` exposes `includeAgentsHome`, which defaults to `true` for compatibility. The shipped `standard`, `ptc`, and `cordis` presets set it to `false`, so their agents retain project skills, Harness-home skills, custom roots, and bundled preset skills while omitting the shared global root. A deployment can enable the shared root explicitly in a later preset patch when it needs those skills.

## Alternatives considered

**Remove the skill catalog from the first request.** This would prevent the model from selecting a clearly matching skill by description and would change the existing skill invocation contract.

**Shorten every skill description.** This reduces the cost but still sends unrelated global skills and does not address the source of the oversized catalog.

**Disable all default skill roots.** This would also remove project and Harness-home skills that are relevant to the current deployment.

## Consequences

The default presets no longer make shared global skills model-visible. Explicit project, Harness-home, custom, and bundled skill discovery remains available, and `includeAgentsHome: true` restores the previous behavior. The first request still includes the tools required by the selected preset; reducing that separate tool schema cost requires a distinct per-session tool-loading design.
