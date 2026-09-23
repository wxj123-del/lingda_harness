# Agent Note: GitCode source updater

Status: implemented

English | [中文](2026-09-23-gitcode-source-updater.zh.md)

## Problem

The source-checkout update path still queried the old AtomGit endpoint even though the maintained Lingda Harness repository is `https://gitcode.com/XJ-Cyber/lingda-harness`.

## Decision

Use GitCode as the single canonical update source in both the browser fallback commit check and the Host Git updater. Fetches use a stable `gitcode/main` tracking ref, compare the local branch with the remote head, and keep the existing clean-worktree and fast-forward-only safeguards. Settings copy and package documentation now name GitCode consistently.

## Consequences

The Settings button reports commits from the repository users actually need to follow. A clean checkout can fast-forward, install the frozen lockfile, rebuild, and restart through the existing Host update operation. Dirty, diverged, detached, and local-ahead checkouts remain blocked rather than risking data loss.

## Validation

Git workspace and Settings update tests pass. Client UI TypeScript, Remote TypeScript, and `git diff --check` pass.
