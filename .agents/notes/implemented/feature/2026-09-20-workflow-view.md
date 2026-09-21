# Agent Note: Session workflow view

Status: implemented

English | [中文](2026-09-20-workflow-view.zh.md)

## Problem

The conversation header exposes a detailed Trajectory ledger, but the ledger requires readers to reconstruct the causal chain between a model step, its tool calls, nested calls, and results. A compact overview is needed for understanding an active session before opening record-level details.

## Decision

The Trajectory client plugin registers a localized `workflow` Conversation view beside the existing `trajectory` view. It projects the resident Trajectory snapshot into connected cards for inputs, model steps, tool calls, nested calls, and results. Tool and result cards open an independent inspector beside the workflow with arguments, results, errors, and nested calls, so inspection stays in the workflow instead of navigating to the Token trajectory. Running calls remain visible with an explicit running state; missing results are not inferred as successful.

The projection stays client-side and reads the existing session snapshot. It adds no session events, model-visible fields, persistence records, or new tool execution behavior. The view uses bounded single-line previews for arguments and content, with the complete payload still owned by the Trajectory inspector.

## Alternatives considered

**Add a workflow section above the ledger.** Rejected because the ledger and overview have different scanning goals; a separate view keeps the existing dense inspection surface unchanged and gives the workflow chain enough vertical space.

**Build a second event or persistence projection.** Rejected because Trajectory already pairs tool calls, results, nested calls, and running state. A second projection would duplicate lifecycle logic and create another source of truth.

**Show only top-level tool calls.** Rejected because nested PTC calls are part of the execution chain users need to understand; nested calls are rendered in dispatch order under their parent result.

## Consequences

The conversation view ring gains a `工作流` / `Workflow` tab. The overview is intentionally bounded to the loaded Trajectory window, so older unloaded history appears after the existing Trajectory paging path loads it. Tool cards are clickable and keyboard reachable; selecting one expands an in-place inspector while keeping the chain visible. The view does not invent output for calls still running or calls whose result is outside the resident window.
