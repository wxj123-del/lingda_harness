# Agent Note: Repository monitor flow

Status: implemented

English | [中文](2026-09-20-repository-monitor-flow.zh.md)

## Problem

The repository tab showed bounded Git checkpoints but did not give operators a place to register repository targets or understand how a change moves from a worktree snapshot to a visible update.

## Decision

Keep local worktree evidence read-only and session-owned. Add browser-local target storage, a monitor toggle, a four-stage flow from repository to status scan to change parsing to monitor update, and a bounded commit timeline for public GitHub URLs. Public GitHub polling is optional and credential-free; local paths and remotes resolve through existing `agent/git-checkpoint` events, including a single repository nested directly under the session workspace.

## Alternatives considered

**Persist targets in Host or Session data**: rejected because repository paths and URLs should remain browser-local until an explicit persistence contract exists, and the existing Git evidence is intentionally session-owned.

**Run a background watcher for every local worktree**: rejected because the client does not own a reliable cross-platform file-watching lifecycle; the current checkpoint event stream is the supported source of local change evidence.

**Support authenticated and non-GitHub providers immediately**: rejected because credential storage and provider-specific API contracts would expand the feature beyond the requested manual monitoring flow. Non-GitHub URLs can still become connected when the local checkpoint reports a matching `origin`; only remote polling remains unsupported.

## Consequences

Repository targets survive a browser refresh but are not sent to the Host or persisted in Session data. GitHub polling is limited to public HTTPS API responses and a small commit window; private and non-GitHub targets use local checkpoint metadata instead of remote polling. A session workspace with one direct child Git repository is resolved to that repository root. No monitor action writes to a repository.

## Validation

Focused repository parser, flow interaction, Git projection, lifecycle, and package bundle checks pass. The repository-wide GUI suite remains noisy with pre-existing canvas and renderer fixture failures unrelated to this feature.
