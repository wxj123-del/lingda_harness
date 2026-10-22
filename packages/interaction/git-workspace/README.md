---
description: "Git workspace checkpoints and guarded source updates for local Agent sessions and the Web settings panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-git-workspace

English | [中文](README.zh.md)

## Summary

`dsh-git-workspace` records bounded Git checkpoints before and after local Agent turns and exposes guarded clone, push, and fast-forward update actions. The snapshot includes repository identity, branch, status, diff statistics, and a bounded diff; a direct child repository is discovered when the session cwd is only a container. Recording never mutates the worktree, and Git failures remain non-fatal to the turn.

## Use

Compose `GitWorkspaceService` in a Cordis root. The base bundle mounts it by default, so ordinary CLI, Web, and preset sessions with an absolute `cwd` receive checkpoints automatically.

```yaml
git-workspace:
  enabled: true
  maxStatusBytes: 24000
  maxDiffStatBytes: 4000
  maxDiffBytes: 24000
```

The `agent/git-checkpoint` event is the stable integration point for trajectory UIs and exports. Consumers should treat missing or failed Git data as an unavailable snapshot and continue rendering the session.

## Table of Contents

- [Use](#use)
- [Source map](#source-map)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, config, checkpoint event, and guarded Git operations |
| [`tests/git-workspace.spec.ts`](tests/git-workspace.spec.ts) | Turn ordering and disabled-plugin coverage |

## Model Experience

### Git checkpoint context

#### What the model sees

The `agent/git-checkpoint` Session event records bounded repository facts for trajectory and export consumers. It is evidence for the human-facing session view, not an extra prompt section or a command schema.

#### Token effect

Checkpoint fields are not added to model requests by this package. A consumer that explicitly renders a checkpoint in context controls any resulting token cost.

#### KV Cache effect

Recording a checkpoint does not change the model request prefix or cache policy.

## Known Limitations and Deferred Work

- Only sessions with an absolute `cwd` are inspected.
- Output is bounded per field and is not a complete repository export.
- Untracked files appear in status; their contents do not appear in `git diff HEAD`.
- Git failures are recorded on the checkpoint and never fail the Agent turn.

No runtime invariant companion is published because this plugin's contract is the session checkpoint event itself; it owns no separate replay invariant.

### Dev Note

The service owns Git process invocation and checkpoint persistence; UI consumers render the event without gaining mutation authority.
