# Agent Note: Incremental workflow node audit persistence

Status: implemented

English | [中文](2026-09-23-workflow-node-audit-persistence.zh.md)

## Problem

Persisting the complete workflow view for every node start and end duplicates the run result and grows Session history with the number and size of nodes.

## Decision

Session Controller persists one `visual-workflow/node` event for each validated node audit update. Run start and terminal state continue to use complete `visual-workflow/run` checkpoints. Cold recovery folds incremental node events into the latest run checkpoint and also accepts legacy checkpoints that already contain a complete audit array.

## Alternatives considered

**Keep full run checkpoints for every node:** Rejected because repeated run metadata and summaries consume durable history unnecessarily.

**Persist only the terminal run checkpoint:** Rejected because a live or interrupted run would lose the node timeline needed for diagnostics.

## Consequences

Live audit remains available from memory, while durable history records bounded node updates without retaining repeated run values. The `visual-workflow/node` event is ignorable so older readers can preserve conversation history when they do not understand this auxiliary record. Recovery retains compatibility with existing `visual-workflow/run` audit arrays.

## Verification

Session Controller tests cover folding a start/end node pair over a cold persisted run and assert that live node updates do not create extra full run checkpoints. Host TypeScript compilation passes.
