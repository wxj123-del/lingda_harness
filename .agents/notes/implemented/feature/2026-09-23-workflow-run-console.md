# Agent Note: Workflow run console

Status: implemented

English | [中文](2026-09-23-workflow-run-console.zh.md)

## Problem

The visual workflow editor could start a Host-owned run, but it did not retain the run identity, accept a real test input, expose cancellation, or show settled results and recent history.

## Decision

The editor now stores text or JSON test input, passes it to the direct Session workflow start call, tracks the returned run id, polls Host status, supports cancellation and retry, and renders status, duration, Agent count, errors, JSON-safe results, and recent run history. The Host adds bounded input validation and concurrent-run limits per Session and globally.

## Consequences

Direct runs are now inspectable and controllable without leaving the workflow console. Run history remains Host-owned and bounded; the browser only receives the redacted run view. Empty default input remains backward-compatible with the existing runner callback contract.

## Validation

Session Controller and UI Layout TypeScript checks pass. The workflow panel client suite passes 12 tests, including input forwarding and cancellation. Session Controller, Remote, and UI Layout bundles pass. `git diff --check` passes.
