# Agent Note: Long-task durability — task state, turn budgets, and recoverable compaction

Status: implemented

English | [中文](2026-10-19-long-task-durability.zh.md)

## Problem

A long task in this harness could not survive its own context. Three gaps combined into one failure mode.

The `todos` projection is per-turn working memory: it returns `null` at every `turn/start`. A multi-turn task therefore had no persistent checklist unless the model rewrote the whole list each turn, and nothing recorded which acceptance criteria had actually been demonstrated.

The core loop had no step, turn, token, or wall-clock ceiling. The only bounds were the personal-agent mode step counts and `defaultMaxGoalRounds`; both count iterations, not cost, and neither is available to a composition that does not mount personal-agent.

Compaction produced one flat summary. A later compaction summarized the earlier summary, so detail degraded with each pass, and nothing could re-read the original. The checkpoint also had no fixed section for files, acceptance criteria, or evidence, so those facts were preserved only when the summarizer volunteered them.

## Decision

**Durable task state.** `dsh-task-state` registers a last-write-wins `task` projection over one `task/state` event carrying a complete snapshot: objective, acceptance criteria, evidence records, decisions, and handoff. Mutation is a pure function (`applyTaskPatch`) so the rules are testable without a session. Evidence carries the 1-based acceptance indices it covers, and coverage counts only `pass` records. Marking a task `succeeded` is rejected while any criterion lacks a passing record, which turns "done" into a checked claim rather than a model assertion. At step 1 of every top-level turn the plugin injects a bounded plugin-sourced card restating the objective, criteria, uncovered indices, recent failures, and handoff. Because the card is derived from the projection rather than from message history, it survives compaction: the earlier messages can be shadowed and the objective still reaches the next request. Settled `bash`/`pwsh` results are recorded as automatic evidence with their real exit code while a task is active.

**Turn budgets.** `dsh-budget-guard` evaluates step, token, wall-clock, and session-turn limits in `agent/pre-step`. Exceeding a limit rejects the step, so the turn closes as `blocked` at a boundary with no partial request, and one `budget/stop` event records the reason, limit, and observed value. Every limit is opt-in. One advisory warning at `warnAtRatio` asks the model to write a handoff, which pairs with the task's `handoff` field: the next turn resumes from durable state instead of from a summary.

**Recoverable compaction.** `compaction-basic` gained an opt-in `sidecar` setting. When enabled, each summary is written to a private per-session file and the checkpoint names its path inside a `<compaction-detail>` block, so a later compaction folding that summary into a coarser one leaves the detail re-readable. The summarization directive gained four fixed sections: Files Touched, Acceptance Criteria and Evidence, Verification Evidence, and Failed Attempts.

The `dsh` base bundle enables `task-state`, mounts `budget-guard` with every limit unset, and sets `sidecar: true` on `compaction-basic`.

## Alternatives considered

**Keep improving the summarizer prompt alone.** Rejected because a summary is lossy by construction and re-summarization compounds the loss; a sidecar plus a projection keeps the facts addressable instead of hoping each summary retains them.

**Make `todos` persist across turns.** Rejected because the list is deliberately a per-turn checklist with whole-list replacement and no stable identity; persistent work needs acceptance, evidence, and decisions, which is a different shape.

**Enforce budgets inside the agent loop.** Rejected because the loop is the shared core every composition mounts; a guard plugin can be tuned or removed per deployment, and the existing `agent/pre-step` waterfall already provides the rejection point.

**Gate completion in the system prompt only.** Rejected because a prompt is advisory. The rejection must happen where the state changes so the model receives a concrete list of missing indices.

## Consequences

A long task now carries its objective, acceptance state, and evidence across turns and compaction, and can state why it stopped. The cost is additional model-visible context: one tool schema, one prompt section, one small card per turn, and a sidecar file per compaction. Evidence is asserted rather than re-verified, so a fabricated record is not detected unless it came from an automatic shell observation; the report records this as the main residual risk. `budget-guard` counts tokens only when the provider reports usage, so a provider that omits usage leaves those attempts uncounted. The sidecar is an aid rather than a precondition: a failed write logs a warning and leaves the checkpoint as it was before sidecars existed.

Verification: `packages/todo/task-state/tests` covers pure mutations, projection survival across turn boundaries, a surface replacement, card injection, automatic evidence, and the compaction-survival path; `packages/guard/budget-guard/tests` covers step, token, and turn stops plus the warning; `packages/compaction/compaction-basic/tests/sidecar.spec.ts` covers the file, its permissions, and the checkpoint reference.
