---
description: "Configure frequency-ranked, on-demand tool discovery in a native-tool preset and inspect its budgets and replay behavior."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-discovery

English | [中文](README.zh.md)

## Summary

Keep a small set of frequently called tools in requests and discover other capabilities when needed. Choose this plugin for native-tool presets with large inherited catalogs. Searches load a few relevant tools without returning the entire catalog. Discovery can add a model round and reduce prompt-cache reuse when loaded tools change. Other presets and execution permissions remain unchanged.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount inside a native-tool preset with `tools`, `systemPrompt`, and `sessionQuery`. All budgets are explicit; [Budget mode](../agent-presets/presets/diaosi/agent.cordis.yml) uses:

```yaml
- id: tool-discovery
  name: '@deepseek-ai/dsh-tool-discovery'
  config:
    initialTools: 4
    maxTools: 8
    pinnedTools: [read, skill]
    fallbackTools: [bash, pwsh, grep, glob, edit, write]
    historySessions: 50
    searchLimit: 2
    descriptionChars: 160
    resultMaxBytes: 2048
```

`initialTools` and `maxTools` include registered pinned tools but exclude `tool_search`. Initial selection ranks actual direct calls in the most recently created `historySessions` other sessions plus the current session, excluding inherited fork counts. Merely exposing a tool does not increase priority. Ties and cold starts use `fallbackTools`, then name. History is read once per agent initialization; committed local events update subsequent state. Unreadable historical sessions are logged and skipped. Cancellation fails that assembly and allows a later retry.

Exact-name searches load only that tool. Keyword queries require every term to match a name or description, rank relevance before frequency, and load at most `searchLimit` results. Descriptions obey `descriptionChars`; the complete rendered JSON obeys `resultMaxBytes`. Tools become visible on the next request only after a successful result is committed. At capacity, least recently used unpinned entries leave the catalog. Retained schemas keep their canonical order. Missing or denied pinned tools are never made available.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The scoped assembly waterfall filters schemas after downstream contributors finish and drops matching `tool:<name>` guidance for hidden tools. Inherited image, speech, and MCP tools participate only when visible to the calling scope. Registrations remain executable under existing restrictions and approval checks: this is schema selection, not an authorization policy.

Selection replays from `request/header`, correlated `tool/call`, and successful `tool/result` metadata. `meta.toolDiscovery` records loaded names; failed or uncommitted results do not activate tools. Existing log events reconstruct the model request without a new event type or format migration. Compaction retains this raw-log state. Disposal removes the tool and listeners and aborts outstanding reads.

No invariant companion is published because selection is a disposable reduction of the authoritative session log, without a separately published store to reconcile. See [implementation](src/index.ts) and [behavior tests](tests/discovery.spec.ts).

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent presets](../agent-presets/README.md) — choosing compositions.
- [Tools](../../core/tools/README.md) — scoped visibility and execution authority.
- [Session query](../../session-query/session-query/README.md) — live and persisted observations.

-----

<a id="model-experience"></a>
## Model Experience

### Selected schemas and discovery results

#### What the model sees

The [generated schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-discovery) defines `tool_search`. Other selected tools retain their original schemas. Results contain matching names, bounded descriptions, and a message indicating availability on the next request or no matches. Only hidden tools' matching `tool:<name>` sections are omitted.

#### Token effect

Initial requests contain at most `initialTools + 1` schemas; later requests contain at most `maxTools + 1`. Schema size itself is not capped. Discovery adds a bounded result and usually an extra model request. Cached input and existing history prevent any guaranteed billing or total-token reduction.

#### KV Cache effect

Catalogs stay stable between discovery, removal, or policy changes. Loading or evicting tools replaces schemas and may invalidate reusable prefixes. Restored sessions keep their recorded selection instead of reverting to the full catalog. Provider cache availability is outside this plugin.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Search is lexical, using English keywords or exact names; Chinese semantic retrieval is not implemented.
- Frequency includes failed direct calls in a bounded sample. PTC inner calls and continuously refreshed global rankings are excluded; PTC presentation is unsupported.
- Skill catalogs, generic guidance, earlier tool output, and conversation history need their own budgets. Only individually attributable tool guidance is hidden.
- Mounted preset generations retain their configuration. New conversations use the updated shipped preset; historical token charges cannot be reduced.

<a id="dev-note"></a>
### Dev Note

None.
