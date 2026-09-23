# Agent Note: Direct visual workflow execution

Status: implemented

English | [中文](2026-09-22-direct-workflow-execution.zh.md)

## Problem

The visual workflow editor could save and inspect a graph, but its test action still opened a chat prompt and depended on the model choosing the workflow tool. That made execution indirect, obscured run ownership, and prevented the editor from reporting a host-owned run state.

## Decision

The Session Controller exposes `workflowStart`, `workflowCancel`, `workflowStatus`, and `workflowList` Remote methods. A start request resolves the addressed Session Agent, compiles the saved graph into the existing `dsh-workflow` script contract, and records a bounded, JSON-safe run view with timeout, cancellation, disposal, and Session teardown handling. Workflow lifecycle events are included in the Remote forwarding allowlist.

The browser Session face calls these methods directly. The editor's test action saves the draft once, compiles it, and starts the run without creating a chat submission. Its debug dock listens through `ctx.remote.$on` and displays only the selected workflow's lifecycle events. Credentials remain reference names in the compiled prompt; secret values never enter the graph or run view.

## Alternatives considered

**Keep routing through a chat prompt.** Rejected because execution remains model-mediated, run cancellation cannot be owned by the editor, and a model refusal is indistinguishable from a workflow failure.

**Create a second workflow engine in the UI package.** Rejected because it would duplicate the existing engine's parsing, child-agent lifecycle, cancellation, and resource policies. The Session Controller is the Host owner of Agent authority and is the correct Remote seam.

**Store full result objects and credentials in the browser.** Rejected because workflow results can contain non-JSON values and credential material must stay Host-owned. The Remote view stores only detached JSON values and credential references.

## Consequences

The editor can start a workflow independently of conversation state and receives stable run controls for later run-history and retry surfaces. Runs are retained in Host memory for a bounded recent window and are cancelled when their Session or controller is disposed. The current editor still renders lifecycle events rather than a full run-history table; `workflowList` provides the data seam for that next UI increment.

## Validation

The Session Controller, Remote assembly, and UI layout TypeScript programs compile. The workflow panel client suite passes 11 tests, including direct-run selection, and `git diff --check` passes.
