# Agent Note: Long-task acceptance — re-verified evidence, automatic continuation, and a mechanism benchmark

Status: implemented

English | [中文](2026-10-20-long-task-acceptance.zh.md)

## Problem

The first long-task round made a task durable, gated completion on evidence, and bounded a turn. Three gaps remained.

Evidence proved that a command had passed at some earlier point, not that it still passed. A regression introduced after the recorded run left the task completable on stale proof.

A stop that was not the model's decision — a budget ceiling or a crash — ended the work. The session repair path closed an interrupted turn and stopped; the next move waited for a human.

Nothing measured whether these mechanisms actually worked end to end. Every existing benchmark measured latency and memory, not "did the gate reject, did the continuation happen, did the session finish".

## Decision

**Re-verified evidence.** `dsh-task-state` gained `reverifyEvidence` (default off; the base bundle turns it on), `reverifyTimeoutMs`, and `maxReverifyCommands`. Marking a task `succeeded` now runs in three phases: a tentative apply validates coverage and names the distinct commands backing the task; each command is re-run through `ctx.tools.execute`; then the patch is applied again to the freshly read snapshot. The third phase exists because a re-run lands a `tool/result`, which the shell observer records as new automatic evidence — applying the pre-re-run snapshot would discard it. Re-runs inherit the calling execution's identity as a nested call, so PTC-mode deployments do not deny the native tool name, and approval, sandbox, and timeout policy apply exactly as they did originally. `reverifyEvidence` without `requireVerifiedEvidence` is rejected at load: the second phase only makes sense behind the first.

**Automatic continuation.** `dsh-auto-resume` reads durable stop reasons rather than inferring them: a `budget/stop` event, or a tail closed as `interrupted`. It resumes only when the task is active with a handoff, the agent is idle with no pending input, no armed goal owns continuation, and both the attempt count and the cooldown allow it. Each resume appends `auto-resume/attempt` before queueing the prompt, so a crash between the two still counts. A user cancel sets the attempt counter to infinity, which makes "never again in this session" a single piece of state rather than another flag.

**Mechanism benchmark.** `benchmarks/long-task-acceptance/` drives three scripted scenarios — a rejected false success, a budget stop followed by a resume, and a crash-resume — through the real loop with a fixed model. It asserts only `ok`, `resumes`, and `turns`, and records duration without judging it, because the question is whether the mechanisms fire, not how fast this machine is.

## Alternatives considered

**Re-run commands in a fresh subprocess.** Rejected: bypassing the tool pipeline would skip approval, sandbox, and timeout policy, and would hide the run from the session log — precisely the properties that make re-verification credible.

**Resume on any turn end while the task is active.** Rejected: a turn that the model completed is a judgement, not an interruption. Continuing it would fight the model's own decision and invite loops.

**Let the goal driver own all continuation.** Rejected: goals are opt-in and bounded by rounds; a deployment with a durable task but no goal would never continue. The armed-goal guard keeps the two from double-driving.

**Measure with a real model.** Rejected for this round: a real-model benchmark measures model capability, is non-deterministic, and cannot run in CI. The mechanism benchmark is the complement, not a replacement.

## Consequences

A task can now be refused because a previously passing command regressed, which is a new failure mode for a model that reasonably believed it was done — the error message names the command and its exit code so the fix is actionable. Re-verification spends tokens and wall-clock at completion time, bounded by the command cap and per-command timeout. Automatic continuation spends tokens without asking, bounded by attempt count, cooldown, the handoff requirement, and the armed-goal guard. A deployment that wants none of it sets `reverifyEvidence: false` or `maxAutoResumes: 0`.

Verification: `packages/todo/task-state/tests/reverify.spec.ts` covers a regression, a successful re-run, evidence preservation across the three phases, timeout, the command cap, the disabled path, invalid configuration, and the pure command selection; `packages/guard/auto-resume/tests/auto-resume.spec.ts` covers budget resume, cancel, handoff requirement both ways, the attempt limit, the armed-goal guard, and normal completion; `benchmarks/long-task-acceptance` reports 3/3.
