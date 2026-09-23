# Agent Note: Workflow governance and retry controls

Status: implemented

English | [中文](2026-09-23-workflow-governance.zh.md)

## Problem

The direct workflow console had run controls, but graph execution still lacked node retry policy, strict graph cardinality checks, and a user-configurable run timeout. Built-in templates also needed to produce executable branch graphs rather than only illustrative cards.

## Decision

Workflow nodes can retain a bounded retry count. The compiler emits retry loops for model and condition nodes, reports retry progress, and emits node start/completion and condition branch logs through the existing `log()` hook. Editor validation mirrors the compiler's reachability, terminal-path, identifier, and branch-handle checks. Built-in templates now import with valid graphs, including a two-way review branch, and retain their first published snapshot. Output nodes support template substitution and JSON parsing. Direct test runs retain text or JSON input plus an optional 1-second to 24-hour timeout. Host-side controls continue to enforce input, result, error, metadata, audit, and concurrency bounds.

## Consequences

Workflow authors can make transient model or condition failures recoverable without changing the Host engine. Output nodes can normalize the final value for downstream consumers. Retry remains explicit per node and does not hide infrastructure exceptions. Timeout remains Host-owned and cancellation-safe.

## Validation

UI Layout and Session Controller TypeScript checks pass. The workflow compiler and panel suites pass 17 tests. Remote client TypeScript, bundles, client UI locale verification, and `git diff --check` pass.
