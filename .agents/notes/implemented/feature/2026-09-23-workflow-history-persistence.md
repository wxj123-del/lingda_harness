# Agent Note: Durable visual workflow run history

Status: implemented

English | [中文](2026-09-23-workflow-history-persistence.zh.md)

## Problem

Workflow run history lived only in the Session Controller process. Restarting the Host discarded completed runs, and status/list calls could not recover a run from a persisted Session.

## Decision

The Host appends a `visual-workflow/run` checkpoint when a visual workflow starts and a second checkpoint when it settles. `workflowList` reconstructs the latest checkpoint for each run from the attached or cold Session log, merges live records over persisted records, filters and sorts the merged view, and preserves the existing limit. `workflowStatus` can read a persisted terminal run, while cancellation rejects runs that are no longer live.

The event is registered in the Session persistence catalog and stores only the redacted run view already exposed by the Remote API. Inputs are represented by byte counts, not payloads.

## Consequences

Run history survives Host restart and remains available without activating a Session Agent. In-memory running state remains authoritative during execution, while persisted checkpoints provide a durable terminal view. Old or malformed event payloads are ignored by the reconstruction helper instead of being exposed as invalid Remote data.

## Validation

Session Controller host/client TypeScript checks, Remote host/client TypeScript checks, persistence catalog verification, and focused Session Controller, workflow compiler, and workflow panel tests pass. The focused suite passes 27 tests.
