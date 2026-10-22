# Agent Note: Personal local Agent workbench controls

Status: implemented

English | [中文](2026-09-20-personal-agent-workbench.zh.md)

## Problem

The existing Agent surface needed one place to express personal modes, bounded context, local retrieval, tool discovery, and workspace evidence without duplicating policy across UI and runtime plugins.

## Decision

Personal Agent modes, request Context Budget, local knowledge retrieval budgets, bounded tool discovery, and read-only Git checkpoints compose through existing DSH session events and plugin seams. Mode policy filters model-visible tools and enforces the same restriction at execution; legacy preset sessions remain unmanaged until the user selects a personal mode.

Context assembly retains system instructions and the current user request before adding recent history, retrieval, and tool results. It clips oversized tool results, marks duplicate context, and records estimated system, schema, history, knowledge, and tool-result tokens in `agent/request-context`. Knowledge retrieval applies a similarity threshold, content deduplication, result count, and estimated-token budget. Tool discovery records selection reasons and can restore a configured safe recovery set after a miss.

Coding turns capture bounded `git status`, branch, diff statistics, and diff text before and after the turn. The Token ledger renders these facts as a read-only Git workspace view with file statuses, counters, and expandable diff text; no Git mutation or automatic commit is performed.

## Alternatives considered

Keeping each budget and evidence policy in its owning UI or tool plugin was rejected because it produced competing decisions for the same request. A new standalone orchestration service was also rejected in favor of the existing Session events and plugin seams.

## Consequences

The ledger explains request context and workspace changes without treating estimates as provider billing. A hard context budget may retain an invariant message above the configured estimate when dropping it would lose the current user request or system instructions. Knowledge and discovery controls can reduce irrelevant context but may require a later search or a new retrieval request. Git evidence is intentionally bounded and may omit older diff lines.

Focused unit tests cover current-request retention, knowledge result selection, discovery reasons and recovery, Git projection, and existing ledger behavior. Cordis and persistence catalogs are regenerated from source.
