# Agent Note: Durable checkpoint retention in context routing

Status: implemented

English | [中文](2026-09-23-context-checkpoint-routing.zh.md)

## Problem

Context routing can remove older messages from a request snapshot even when compaction has already produced a durable checkpoint containing the task's decisions and current state.

## Decision

The router retains the latest active compaction checkpoint for `recent` and `task` routes as a required message, even when it falls outside the configured message tail. An explicit `fresh` route excludes the checkpoint so a declared topic switch remains isolated. The checkpoint remains subject to the same unified token accounting and can contribute to an intentional over-budget snapshot when the required system prompt and current request already consume the budget.

## Alternatives considered

**Rely on the recent-message tail.** Rejected because a long sequence after compaction can push the checkpoint out of the tail before the task is finished.

**Retain checkpoints for every route.** Rejected because `fresh` is an explicit isolation request and must not inherit prior task memory.

**Add a second task-memory store.** Deferred because the compaction checkpoint is already durable, model-visible, and replayable; a second store would duplicate state before semantic recall is available.

## Consequences

Long tasks keep their latest durable decisions available without sending the complete transcript. Fresh-topic routing remains isolated. The router now depends on the compaction checkpoint predicate, and checkpoint retention is visible in the existing selected-message audit rather than a new event type.

## Verification

The context-router, personal-agent, and token-meter focused suites pass 56 tests, and TypeScript project checks pass for all three packages.
