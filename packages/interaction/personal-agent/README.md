---
description: "Local Agent modes with durable policy, bounded tools, and task lifecycle state."
kind: "package-reference"
---

# @deepseek-ai/dsh-personal-agent

English | [中文](README.zh.md)

## Summary

`dsh-personal-agent` owns the active Agent mode and applies its policy at both model presentation and tool execution boundaries. It persists mode and task lifecycle events in the Session log.

## Table of Contents

- [Use](#use)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use

Mount the plugin in a Cordis composition. The default modes are `qa`, `research`, `coding`, and `execution`; each mode declares visible tools, step and context budgets, approval behavior, and sandbox posture.

The service exposes the current mode and task state through its Host and Remote faces. Mode changes and task transitions remain durable, so a resumed or forked Session can reconstruct the active policy and task snapshot.

## Model Experience

### Policy boundary

#### What the model sees

The model receives only the tools and context allowed by the active `agent/mode`. Hiding a tool schema is not treated as authorization; the execution boundary checks the same policy before a call runs.

#### Token effect

Mode-specific context and tool limits bound the request. Policy audit events stay in the Session log and are not added to the model prompt.

#### KV Cache effect

Changing mode can change the tool prefix and therefore the reusable request prefix for later turns.

## Known Limitations and Deferred Work

- Mode policies are local configuration; organization-wide policy synchronization is not included.
- Task snapshots are bounded metadata and do not replace the full Session event history.

No runtime invariant companion is published because this package owns policy and task events rather than a separate replay invariant.

### Dev Note

The package is a Host service with generated Client and Remote faces. Sandbox and approval policy packages remain the authorities for their respective enforcement mechanisms.
