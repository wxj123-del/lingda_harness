---
description: "Durable task state for long-running agent work: a last-write-wins task snapshot, per-turn recitation, evidence-gated completion, and automatic command evidence, for users and maintainers composing or debugging long sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-state

English | [中文](README.zh.md)

## Summary

`dsh-task-state` keeps one task per session as durable session state instead of letting the objective live only in an earlier message. The model creates the task with an objective and verifiable acceptance criteria, records evidence as work proceeds, and may only mark it succeeded once every criterion has passing evidence. A compact card restates the objective, criteria, and missing evidence at the start of every turn, so the task stays in view after compaction and after long tool chains. Settled shell commands are recorded as automatic evidence while a task is active. Use it for work that spans many turns; the per-turn `todo_write` list remains the right tool for a single turn's checklist.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin when an agent must carry one objective across many turns. Mounting it adds the `task_update` tool, a short prompt section describing the policy, the per-turn card, and the automatic command-evidence observer.

### When to choose it

Choose it for multi-turn work whose completion must be demonstrable: a refactor, a migration, a long investigation. Avoid it for single-turn questions and for work whose only deliverable is conversation; the task adds one tool schema, one prompt section, and a small card per turn.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-task-state'
  config:
    injectTaskCard: true
    recordCommandEvidence: true
    requireVerifiedEvidence: true
```

| Field | Default | Meaning |
|---|---|---|
| `injectTaskCard` | `true` | Append the compact card as a plugin-sourced user message at the start of each top-level turn |
| `recordCommandEvidence` | `true` | Append an automatic evidence record for each settled `bash`/`pwsh` call while the task is active |
| `requireVerifiedEvidence` | `true` | Require observed evidence for completion: an automatic record, or a command the session log shows exiting zero |
| `reverifyEvidence` | `false` | Re-run every verified command immediately before a task may be marked succeeded |
| `reverifyTimeoutMs` | `300000` | Wall-clock limit for one re-verification run |
| `maxReverifyCommands` | `8` | Upper bound on distinct commands re-run for one completion attempt |

### What you get

`task_update` returns the complete task after every call, including the 1-based indices of acceptance criteria that still lack passing evidence. Creating a task without an objective fails; marking a task `succeeded` while any criterion lacks passing evidence fails with the missing indices; an explicit `cancelled` is always allowed. Evidence records carry `kind`, an exact `ref`, a `status`, and the acceptance indices they cover. Automatic records are marked `auto`; at most 40 records are retained, and the oldest automatic record is dropped first.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **State lives in the session log.** Every mutation appends one whole `task/state` snapshot, so replay is last-write-wins and a resumed session reconstructs the task without re-reading any message.
- **Acceptance is a contract, not a comment.** Coverage is computed from passing evidence, never from the model's assertion, so a completion claim without evidence is rejected at the tool boundary.
- **The card is the recitation.** Compaction replaces history; the next turn's card restores the objective, criteria, uncovered indices, recent failures, and handoff without depending on any summary.
- **Bounded.** The card is bounded, the objective is truncated, evidence and decisions have caps, so a long task cannot inflate every request without limit.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | Projection key, durable snapshot types, automatic-evidence marker |
| [`src/state.ts`](src/state.ts) | Pure patch application, coverage computation, card and JSON views |
| [`src/index.ts`](src/index.ts) | Projection registration, `task_update` tool, card injection, command-evidence observer |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Todo group map](../README.md) — how `task-state` relates to `tool-todo`.
- [Generated persistence catalog](../../../docs/persistence-catalog.md) — the `task/state` payload schema.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-task-state) — the `task_update` schema the model receives.

-----

<a id="model-experience"></a>
## Model Experience

### Prompt section

#### What the model sees

A fixed section describing the task policy: create one task with verifiable criteria, record evidence with the indices it covers, expect a rejection while criteria lack evidence, use `handoff` before a pause, and remember the task is restated every turn.

#### Token effect

Fixed; one short paragraph in every request.

#### KV Cache effect

Prefix-stable while the mounted composition is unchanged.

### Per-turn task card

#### What the model sees

At step 1 of each top-level turn, a plugin-sourced user message carrying the card below. A card with no decisions or handoff omits those lines.

##### Task card

```markdown
<task_state>
Objective: <objective, truncated to 240 characters>
Status: <status> (revision <n>)
Spent so far: <total> tokens (in <input>, out <output>, <cached> cached)
Acceptance:
  1. <criterion> [covered]
  2. <criterion> [MISSING EVIDENCE]
Recent failing evidence:
- <kind>: <ref>
Decisions:
- <decision>
Handoff: <handoff>
</task_state>
```

#### Token effect

Data-dependent but bounded: at most a 240-character objective, one line per acceptance criterion, the newest three failing records, the newest five decisions, and one handoff line. The spend line appears only when a token meter is mounted; its cached clause appears only after a cache read is reported.

#### KV Cache effect

Append-only within a turn; the card is a new message at the turn boundary rather than a rewrite of earlier messages. A turn that creates or edits the task changes only the next turn's card.

### Tool schema and results

#### What the model sees

The [task_update schema](../../../docs/tool-catalog.md#deepseek-aidsh-task-state) accepts `objective`, `acceptance`, `evidence`, `decision`, `handoff`, and `status`. Every call returns the task view with acceptance coverage flags and uncovered indices; failures are `Error: cannot mark the task succeeded: acceptance <indices> lack passing evidence; record evidence with acceptance indices first` and `Error: creating a task requires objective`.

#### Token effect

One tool schema per request; results scale with the retained evidence and decisions.

#### KV Cache effect

Append-only; existing prefix entries remain reusable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the task is a poor fit.

- **One task per session** — creating a second objective replaces the first; subtasks are not modeled.
- **`manual` evidence stays asserted** — a `command` or `test` record needs an observed run, and a `file` record needs an observed read of that path, but a `manual` record has nothing to observe.
- **Verification reads existing history, never re-runs** — a command that succeeded earlier counts, so a later break is not detected at completion time.
- **Coverage is all-or-nothing per criterion** — any passing record covering an index satisfies it; partial or weighted coverage is not modeled.
- **The card is restated whenever the task changes** — the first step of every turn, plus any later step whose task revision differs from the last card, so a mid-turn creation is visible in the same turn.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is explicitly non-authoritative. The [task-state Agent Note](../../../.agents/notes/implemented/feature/2026-10-19-long-task-durability.md) records the rationale and open directions.

</details>
