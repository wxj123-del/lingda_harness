# Agent Note: Workflow node-level audit

Status: implemented

English | [中文](2026-09-23-workflow-node-audit.zh.md)

## Problem

Workflow runs exposed child-agent lifecycle events but could not explain which visual node was running, how long it took, whether it was skipped, or which bounded input/output summary caused a failure.

## Decision

Add validated `workflow/node-start` and `workflow/node-end` lifecycle events. The compiler emits them around every visual node, including explicit `skipped` states for inactive branches and `blocked` states for nodes downstream of a failed dependency wave. These bindings are enabled only for trusted compiler-generated visual runs, so ordinary model-authored workflow scripts cannot forge node audit records. The PTC guest bounds summaries and the Host validates and closes active nodes on cancellation. Session Controller persists a redacted, capped audit trail with the run correlation id and exposes it through `WorkflowRemoteRunView`; the editor debug feed displays node lifecycle updates.

## Consequences

Operators can correlate a run, wave, node, retry budget, duration, outcome, and bounded summaries without retaining secrets or unbounded payloads. Invariants reject duplicate, unpaired, malformed, and unterminated node lifecycles. Existing agent lifecycle and run history remain compatible.

## Validation

Workflow invariant, guest, PTC, Session Controller, and UI compiler tests pass. Workflow, Workflow PTC, Session Controller, and UI Layout TypeScript checks pass; the generated guest source is current.
