---
description: "Automatic continuation after a runtime budget stop or a crash interruption: resumes an active task from its handoff, bounded by attempt count, cooldown, and an armed-goal guard."
kind: "package-reference"
---

# @deepseek-ai/dsh-auto-resume

English | [中文](README.zh.md)

## Summary

`dsh-auto-resume` continues work that stopped for a reason other than the model's decision. When a turn ends on a runtime budget or a crash-interrupted tail, and the session's task is still active with a handoff, the plugin appends a durable `auto-resume/attempt` record and queues one more turn carrying that handoff. It never resumes a turn the user cancelled, never re-drives a turn that completed, and never competes with an armed goal — the goal driver owns continuation there.

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

Mount it beside `dsh-task-state` and `dsh-budget-guard`. The `dsh` base bundle mounts it with ten attempts; a composition that does not want automatic continuation sets `maxAutoResumes: 0`.

### When to choose it

Choose it for unattended or scheduled work where a budget stop should not end the job. Avoid it when every turn should need a human decision — a resume spends tokens without asking.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-auto-resume'
  config:
    maxAutoResumes: 10
    minIntervalMs: 1000
    requireHandoff: true
    resumeOnError: false
```

| Field | Default | Meaning |
|---|---|---|
| `maxAutoResumes` | `3` | Automatic resumes per session; `0` disables the effect |
| `minIntervalMs` | `1000` | Minimum idle time between a stop and the resume it triggers |
| `requireHandoff` | `true` | Require a non-empty task `handoff` before resuming |
| `resumeOnError` | `false` | Also resume after a turn that ended with an LLM error |

### What triggers a resume

| Previous turn ended because | Resumes? |
|---|---|
| A `budget/stop` record was written (steps, tokens, wall-clock) | Yes |
| The tail was closed as `interrupted` after a crash | Yes, once the resumed agent is idle |
| The user cancelled (`aborted`) | No — and the session never resumes again |
| The model finished (`completed`) | No |
| The turn was blocked with no budget stop | No — a repeat would loop |
| An LLM error | Only with `resumeOnError: true` |
| The output-token ceiling was hit (`max-tokens`) | No |

Every yes also requires an active task with a handoff, no pending user input, an idle agent, and no armed goal.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Durable before visible.** The `auto-resume/attempt` record is appended before the continuation prompt, so a crash between the two still counts against the attempt budget on the next start.
- **Only observed stops.** The trigger is a recorded stop reason, never a guess about whether the model "really" finished.
- **One owner per continuation.** An armed goal means the goal driver is already continuing this session, so this plugin stands down.
- **Cancellation is final.** A user cancel sets the attempt counter to infinity, which is the simplest way to say "never again in this session" without another piece of state.

### Counting and cooldown

Attempts are counted per agent in memory and pinned by the durable records. `minIntervalMs` reads the last attempt time, so a burst of stops cannot produce a burst of resumes.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Policy validation, per-agent state, event wiring, resume prompt |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Guard group map](../README.md) — the sibling loop-hygiene guards.
- [task-state](../../todo/task-state/README.md) — the task snapshot and handoff this plugin reads.
- [budget-guard](../budget-guard/README.md) — the guard whose stop this plugin answers.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-auto-resume) — every accepted field.

-----

<a id="model-experience"></a>
## Model Experience

### Resume prompt

#### What the model sees

One plugin-sourced user message carrying the reason and the task's handoff.

##### Resume prompt

```markdown
<auto_resume reason="<reason>">
The previous turn stopped before the objective was complete (<reason>).
Resume from this handoff instead of restarting completed work:

<handoff>

Re-read the task card, verify the current workspace state, then continue.
</auto_resume>
```

#### Token effect

One message per resume, plus the handoff text it quotes; the task card arrives separately at the next turn's first step.

#### KV Cache effect

Append-only; the resume message follows whatever prefix the interrupted turn left intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No fake-completion detection** — a turn that ends `completed` while the task is still active is not resumed; that judgement belongs to a goal or a human.
- **Crash recovery depends on the host** — the interrupted-tail path only fires when the host resumes the agent; this plugin does not scan sessions on its own.
- **Attempts reconcile with the log, not with wall-clock history** — the counter is re-read before every decision, so a restart inherits the attempts already recorded; only records written by a build that predates this plugin are invisible.
- **One resume per idle transition** — a resume that immediately stops on the same budget waits for the next cooldown window rather than retrying in place.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is explicitly non-authoritative. The [long-task durability Agent Note](../../../.agents/notes/implemented/feature/2026-10-19-long-task-durability.md) records the surrounding rationale.

</details>
