# Agent Note: Context budget overflow audit and acknowledgement routing

Status: implemented

English | [中文](2026-09-23-context-budget-overflow-audit.zh.md)

## Problem

Required system, current-user, and durable checkpoint messages can exceed the effective request budget. The selector must retain those invariants, but without an explicit audit the UI cannot distinguish a bounded request from an unavoidable overflow. Short acknowledgements also contain no task terms and were being classified as fresh topics.

## Decision

`ContextSelection` and the durable `context/router` event record `budgetExceeded` and `overflowTokens` after the final tool-pair closure. Optional candidates are categorized so task-bearing user messages and model output are preferred over passive plugin context under pressure; passive plugin context is additionally capped at 25% of the message budget by default, while active open-turn units retain priority and remain subject to the overall budget. When durable task lifecycle events exist, a task continuation recalls the latest prior task's model-visible messages and records its `taskId` and recall count. The event also records an optional `estimatedRequestTokens` total that includes tool schemas, `estimatedWindowTokens` including the reserved output budget, and `requestOverflowTokens` for the full provider-window envelope. It also records bounded per-message metadata with truncated previews. Metadata contains at most 128 selected messages and reports any omitted count. The Token trajectory detail renders a localized warning when required content exceeds the effective message budget or the full request envelope exceeds the provider window. When a global router audit exists, the personal-agent breakdown is labeled as policy preprocessing and the route audit is treated as the final request snapshot. The preview uses the bounded final metadata when present and warns when persisted messages differ from tool-result clipping or duplicate-context replacement. The provider runtime now emits an adapter-ready boundary after file/image projection; when that projection changes messages, the router appends a bounded `finalPayload` audit so the preview can show the provider-visible projection. The router recognizes short acknowledgement and continuation phrases as task-context requests before lexical matching, preserving their recent task context without a model or embedding call. When an open turn contains a tool unit that cannot fit, older-turn candidates are not used to backfill the remaining budget. Open-turn boundaries are recovered from durable turn and user-message events after a router restart.

## Alternatives considered

**Drop required messages to satisfy the budget.** Rejected because removing the current request or system instructions can make the provider request invalid or change the task contract.

**Silently rely on provider overflow handling.** Rejected because the request audit and context preview would claim a bounded snapshot while the provider may reject it.

**Treat every token-free short phrase as recent context.** Rejected because empty or generic text still lacks enough evidence to reconnect an unrelated conversation; only a conservative acknowledgement vocabulary is promoted to task context.

## Consequences

Budget overflow is now visible and measurable, while required messages remain intact. The router's lexical policy remains deterministic and local. The warning reports the fixed token-meter estimate, so provider-specific tokenizer differences remain a documented residual risk. The acknowledgement vocabulary may need additions as real conversation samples reveal new forms.
The router memoizes token estimates by immutable message and request-header identity, so repeated selection and audit passes do not reprice the same long tool chain.
Open-turn context may therefore contain fewer total messages than an older-history-first greedy fill, but it preserves the active tool working set as the higher-value continuation.
The browser can distinguish policy preprocessing from the final routed request. Final metadata makes transformed-message previews inspectable without duplicating complete bodies, but it remains a bounded preview rather than a byte-for-byte provider payload.
Durable task recall is indexed per live Session and folded incrementally from a sequence watermark. The first lookup still replays the existing log for restart safety; repeated requests avoid rescanning the complete transcript. Recall IDs are capped by `taskMessages`, so a short acknowledgement cannot expand to an entire prior task transcript. Clearing the active turn at `turn/end` prevents later events from being attributed to the wrong task while retaining lifecycle records for continuation recall.

## Verification

The focused context-router, personal-agent, token-meter, and Token trajectory suites pass with 175 tests, including required-message overflow, full-window accounting, bounded durable-task recall, acknowledgement routing, incremental index coverage, restart recovery, downstream-normalized and adapter-projected final-payload auditing, UI warning, and selected-snapshot coverage. The context-router and LLM TypeScript project checks pass; the LLM service suite passes 267 tests. Named documentation-pair checks and `git diff --check` pass. The repository-wide client UI i18n verifier still reports one pre-existing hard-coded `"· · ms"` string in `packages/client/ui-layout/src/client/authoring/WorkflowEditor.tsx:699`.
