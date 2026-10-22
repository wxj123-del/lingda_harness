# Agent Note: Evidence-backed Game Studio evolution

Status: implemented

English | [中文](2026-09-29-game-studio-evolution.zh.md)

## Problem

Game Studio checkpoints and release reports preserve what happened in one run, but a later run cannot distinguish a reusable lesson from model recollection or a one-off project fact. Automatically editing bundled skills from one run would spread unsupported guidance across projects and make regressions difficult to trace.

## Decision

`studio_evolve` maintains a project-local playbook from immutable observations under `.game-studio/evolution/observations/<rule-id>/<run-id>.json`. Every observation reads an already saved release report and copies named evidence plus the source revision. Support requires a `READY` report and passed referenced checks; contradiction requires a `BLOCKED` report and a failed referenced check.

The runtime computes each rule as `TRIAL`, `ACTIVE`, or `CONTESTED`. A configurable number of independent supporting runs activates guidance; any contradiction quarantines it. The Game Studio prompt loads this playbook during `SCAN`, applies only active guidance automatically, and keeps bundled skills immutable. Promotion from one project's playbook into the built-in shelf remains a reviewed source change backed by cross-project evidence.

## Alternatives considered

**Let the model rewrite bundled skills after every run.** Rejected because one hallucinated causal claim or project-specific workaround would immediately affect unrelated projects without review or rollback evidence.

**Store free-form retrospective notes only.** Rejected because prose does not verify the source revision, release outcome, or named check that supports a lesson and cannot compute when guidance is safe to reuse.

**Require human approval for every project-local rule.** Rejected because repeated verified runs provide a useful automatic threshold inside one workspace; human review remains mandatory for cross-project promotion into shipped skills.

## Consequences

Later runs reuse guidance that survived repeated release evidence, while failed evidence stops automatic reuse. Immutable per-run files avoid concurrent aggregation rewrites and retain the exact evidence snapshot. This mechanism establishes evidence correlation rather than causality, so the activation threshold is configurable and built-in skill changes remain outside the automatic loop.
