# Agent Note: Workflow interchange files

Status: implemented

English | [中文](2026-09-23-workflow-interchange.zh.md)

## Problem

The visual workflow editor could create, publish, copy, and run graphs, but moving a workflow between installations still required manual reconstruction. A mature workflow console needs a portable file format that is safe to inspect and cannot overwrite an existing published workflow on import.

## Decision

Add a versioned `dsh-workflow` JSON/YAML interchange envelope. Export includes the workflow description, instructions, graph, edges, and viewport; it does not include archives, run history, or secrets. Credential values remain references only. The console can import `.json`, `.yaml`, and `.yml` files with size, node, edge, identifier, and graph-reference bounds. Imported files receive a fresh id and always enter the draft state. The editor exposes explicit JSON and YAML download actions.

## Consequences

Workflows can be reviewed in source control or transferred between installations without a command-line step. Imports cannot silently replace a published workflow and must be published again after review. Hand-authored raw workflow objects are accepted for convenience, while unsupported envelope versions fail clearly.

## Validation

Workflow panel and interchange tests pass 20 tests. UI Layout TypeScript passes, and `git diff --check` passes.

