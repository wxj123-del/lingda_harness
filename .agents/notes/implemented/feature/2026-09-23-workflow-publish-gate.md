# Agent Note: Workflow publication gate

Status: implemented

English | [中文](2026-09-23-workflow-publish-gate.zh.md)

## Problem

The editor displayed draft and published states, but enabled draft workflows were still registered as normal chat tools. Later release-history support also needed a clear rule for workflows that have unpublished edits on top of an existing release.

## Decision

Workflow tool registration now requires an enabled workflow with releasable content. A published record exposes its current graph; a draft with release history exposes its latest immutable snapshot, while a new draft without a release is not registered. The catalog uses the same predicate for its badge and chat action. Legacy records without a lifecycle marker remain runnable for backward compatibility.

The editor compares only release-owned content (title, description, instructions, graph, and derived steps) with the latest release. Saving or testing changed release content persists a draft and leaves the previous snapshot live. Test input, timeout, enabled state, and canvas viewport do not change publication state. A copied workflow always starts as an unpublished draft with no release or retained test input.

## Alternatives considered

Registering every enabled draft was rejected because unfinished graph changes would reach ordinary conversations. Replacing the live release on every save was rejected because authors need a reviewable draft boundary.

## Consequences

Editing and testing can happen without exposing unfinished graph changes to ordinary conversations or taking the previous release offline. Publishing remains the only boundary that replaces model/tool execution content, while disabling a workflow still removes it from the tool registry.

## Validation

Workflow panel, layout apply, and compiler tests pass. Client UI TypeScript and locale verification pass, together with `git diff --check`.
