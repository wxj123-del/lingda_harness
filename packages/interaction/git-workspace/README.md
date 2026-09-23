---
description: "Git workspace checkpoints and guarded source updates for local Agent sessions and the Web settings panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-git-workspace

English | [中文](README.zh.md)

## Summary

`dsh-git-workspace` records bounded Git evidence for local sessions and exposes guarded, explicit clone/sync operations for the repository UI. It records a workspace snapshot before and after each turn with the repository root, origin URL when available, current branch, short status, diff statistics, and a unified diff. When the session cwd is not itself a repository but contains one direct child repository, that child is resolved for the snapshot. Resuming a session that already has Git checkpoints schedules one fresh after-checkpoint immediately, so the UI can reflect repository layout changes without requiring a new user turn. Clone and sync reject unsafe URLs, non-empty unrelated folders, dirty worktrees, and non-fast-forward updates. The event is ignorable and can be rendered by trajectory clients without coupling Git behavior to a particular Agent mode or preset.

The plugin does not mutate the worktree while recording checkpoints. Its Remote update action checks `https://gitcode.com/XJ-Cyber/lingda-harness` directly, even when the checkout has no `gitcode` remote configured. It requires a clean checkout and a fast-forward-only update, installs the frozen lockfile, rebuilds the project, and schedules a Host restart. Dirty, diverged, detached, and local-ahead checkouts are refused.

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

## Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, config, checkpoint event, and guarded Git operations |
| [`tests/git-workspace.spec.ts`](tests/git-workspace.spec.ts) | Turn ordering and disabled-plugin coverage |

## Limits

- Only sessions with an absolute `cwd` are inspected.
- Output is bounded per field and is not a complete repository export.
- Untracked files appear in status; their contents do not appear in `git diff HEAD`.
- Git failures are recorded on the checkpoint and never fail the Agent turn.

No runtime invariant companion is published because this plugin's contract is the session checkpoint event itself; it owns no separate replay invariant.
