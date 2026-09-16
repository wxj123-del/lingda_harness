---
description: "Optional Token trajectory replacement with per-attempt usage and inspectable request sources."
kind: "package-bundle"
---

# @deepseek-ai/dsh-client-ui-step-insight

English | [中文](README.zh.md)

## Summary

An opt-in browser plugin replaces the Trajectory tab with a live Token ledger. Every loaded assistant attempt and compaction has a separate row, with input, output, cache reads, cache writes, reasoning, timing, tool calls, and source event references. Its higher-priority `trajectory` slot registration restores the original view when unloaded. The original trajectory package remains mounted as the conversation target owner.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Build from the repository root, then start a Web profile with the source overlay:

```sh
pnpm run build
pnpm dsh --profile web --patch ./packages/client/ui-step-insight/cordis.source.patch.yml --port 3082 --no-open
```

For persistent installation, install the built checkout with `dsh plugin --profile web add ./packages/client/ui-step-insight`, restart that profile, and open a Session's Token trace tab. Remove the package with `dsh plugin --profile web remove @deepseek-ai/dsh-client-ui-step-insight` and restart to restore the original view. The package declares `dsh.bundle`; its patch mounts the plugin, and the host discovers the built browser export through `dsh.client`.

The ledger updates from the existing Session event feed. Search finds steps, models, providers and tool names; filters select missing usage or interrupted attempts; sorting ranks reported totals or their known subtotals. Selecting a row opens accounting, input sources, output blocks, tools and raw events. Export writes the loaded ledger and its durable source events to JSON. Loading older history extends both the ledger and its accounting scope.

### Accounting

Provider counters are authoritative. Input is uncached input plus cache reads and writes. Reasoning is already included in output. An exact provider total is retained when consistent with the known buckets; otherwise an exact total requires every input bucket. Missing fields display as unknown. `≥` shows only the sum of reported counters when an exact aggregate is unavailable. Live usage checkpoints replace earlier samples; a durable settlement replaces its transient stream. Separate retry attempts and compaction requests retain separate usage.

Input sources apply recorded surface replacements before listing the historical prefix. System text, user and plugin messages, previous outputs, tool results, and each tool schema are inspectable. Content sizes use a labelled four-characters-per-token text estimate, independently of provider accounting. Tool arguments belong to model output; tool results may enter later request input. PTC subcalls are marked internal and are never added as separate model charges.

Tool definitions also show estimated conversation similarity, matched words, and whether the current step called the tool. The reference defaults to the latest retained user message and can include all user messages in the selected request. Sorting can preserve schema order or rank similarity. Expand the reference or tool to inspect its text and evidence. Scores use distinct word terms, common Chinese/English task aliases, and IDF-weighted cosine similarity over tool names and descriptions. System prompts, plugin messages, assistant responses, tool results, attachment metadata, schema parameters, and later messages do not contribute. Missing comparable text stays unknown; comparable text with no matching words scores zero.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The client registers one higher-priority conversation view and a locale dictionary through disposable effects. A registration-private renderer hook reads the existing `SessionBinding.eventSource`; the plugin creates no additional subscription transport or Host service. `step-model.ts` folds request attempts, `input-parts.ts` reconstructs selected input sources, and `usage.ts` preserves accounting uncertainty. No invariant companion is published because the plugin owns only derived presentation, with no independently mutable Host relationship.

Append deltas reuse request assembly, while history replacement, paging and settlement rebuild from the authoritative window. The conversation owner projects slot winners into its tabs, so the replacement contributes one visible tab and disposal restores the original label. The profile patch inserts the `ui-step-insight` row; the manifest limits its browser entry to Web.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Conversation assembly](../../../docs/subsystems/conversation.md) owns view registration and source data.
- [Token meter](../../llm/token-meter/README.md) owns full-session provider accounting and context pressure.
- [Decision record](../../../.agents/notes/implemented/feature/2026-09-16-token-trace-plugin.md) explains the optional replacement and precision limits.

<a id="model-experience"></a>
## Model Experience

None, as this package only renders recorded Session data in the browser and makes no model requests.

#### KV Cache effect

The plugin does not modify prompts, tools, history or provider requests and therefore preserves the existing request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Provider precision:** per-message exact tokenization and prices are not recorded. Text estimates are not billing counts and exclude image tokens, file conversion and provider framing. Streaming exact counts appear only when the provider reports them.
- **Loaded history:** totals cover the loaded window, not unseen history or separate child Sessions. Title-generation and other auxiliary calls without Session usage records cannot be included. Missing usage remains unknown even for failed requests.
- **Input reconstruction:** custom plugin message projections and dedicated compaction prompts are not reconstructed. Pagination gaps are marked; timestamps missing from older history remain unavailable.
- **Similarity precision:** local lexical estimates are not embedding semantics, model confidence, or tool-call probabilities. Limited aliases cannot bridge every language or paraphrase. Scores depend on the request's tool catalog and loaded user text; they do not alter requests or incur model usage.
- **Presentation scope:** this view replaces the trajectory ledger, not its specialized graphical timeline or image gallery. Raw records and source content remain available. JSON exports include loaded conversation content and tool results.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

The [decision record](../../../.agents/notes/implemented/feature/2026-09-16-token-trace-plugin.md) covers accounting boundaries and the browser replay scenario.

</details>
