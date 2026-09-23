# Agent Note: Workflow publication gate

Status: implemented

English | [中文](2026-09-23-workflow-publish-gate.zh.md)

## Problem

The editor displayed draft and published states, but enabled draft workflows were still registered as normal chat tools. A model could invoke a draft even though the catalog disabled its user-facing chat action.

## Decision

Workflow tool registration now requires an enabled workflow whose lifecycle state is not `draft`. The catalog uses the same predicate for its badge and chat action. Legacy records without a lifecycle marker remain runnable for backward compatibility; newly created and imported records are explicit drafts until published. Direct editor test runs remain available through the Host Session runner.

## Consequences

Editing and testing can happen without exposing unfinished graph changes to ordinary conversations. Publishing becomes the single release boundary for model/tool execution, while disabling a workflow still removes it from the tool registry.

## Validation

Workflow panel, layout apply, and compiler tests pass. Client UI TypeScript and locale verification pass, together with `git diff --check`.
