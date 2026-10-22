# Agent Note: Visual workflow audit manifest

Status: implemented

English | [中文](2026-09-23-workflow-audit-manifest.zh.md)

## Problem

The visual workflow Host accepted node audit events by run id only. A malformed or stale script could therefore add unrelated node records to a run history.

## Decision

The visual compiler now returns the node identifier manifest alongside the generated script. `workflowStart` validates a bounded, unique manifest and stores it with the live run. Session Controller audit handlers ignore node events outside that manifest and ignore updates after the run is terminal. The manifest is scoped to the direct visual-editor API; ordinary workflow engine runs retain their existing behavior.

## Alternatives considered

Accepting node events by run id alone was rejected because stale or malformed scripts could contaminate history. Reusing the general workflow engine manifest was rejected because the visual editor has a narrower direct-start contract.

## Consequences

Persisted visual workflow histories contain only node records declared by the graph submitted for that run. Older direct callers must provide the manifest when invoking the visual-editor start endpoint. Unknown audit events no longer pollute the in-memory view or session history.

## Validation

Workflow, PTC, UI Layout, and Session Controller suites pass 1094 tests. Package TypeScript checks, workflow guest verification, client UI i18n verification, persistence catalog verification, and `git diff --check` pass.
