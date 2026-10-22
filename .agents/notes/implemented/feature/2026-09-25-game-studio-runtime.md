# Agent Note: Game Studio runtime records

Status: implemented

English | [中文](2026-09-25-game-studio-runtime.zh.md)

## Problem

The first Game Studio preset version described checkpoints, background jobs, and release states in prompt text, but it had no structured workspace record or executable release decision.

## Decision

Add `@deepseek-ai/dsh-tool-game-studio` to the Game Studio preset. `studio_checkpoint` writes a complete phase record under `.game-studio/runs/<run-id>/checkpoint.json`. `studio_release` validates or persists a report and calculates `READY`, `BLOCKED`, or `NEEDS REVIEW` from evidence. The Web session header exposes the newest durable checkpoint through the `ui-jobs` Game Studio HUD, including the release state, phase, deliverable, next action, blockers, and report paths. Existing `dsh-tool-goal` and `dsh-tool-jobs` remain the long-running objective and process-local job controls; this package records their ids and results rather than duplicating those services.

## Alternatives considered

Keeping the workflow in prompt text would not survive context resets or provide a machine-computed release decision. Duplicating the background-job registry inside this package would split ownership and make job status inconsistent, so the runtime records job ids and reads their existing scoped status instead.

## Consequences

Long tasks have a durable handoff file, a release report, and a session-header view that can be inspected after a context reset. Missing external validation is visible as `NEEDS REVIEW`, while failed checks and explicit blockers are mechanically `BLOCKED`. Cross-process job execution remains a deployment concern; a report cannot claim a job survived a process restart without a restartable artifact and command. The HUD is read-only and deliberately disappears when no valid checkpoint exists.
