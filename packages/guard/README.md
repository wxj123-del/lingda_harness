---
description: "Package map for the loop-hygiene guard family: the advisory repeat-tool reminder, the per-tool-call timeout policy, and runtime turn budgets, for users and maintainers choosing or composing the guards."
kind: "package-group"
---

# guard/ — loop-hygiene guard family

English | [中文](README.zh.md)

## Summary

The `guard/` group keeps the agent loop productive by watching four failure patterns. `repeat-tool-reminder` notices when the model repeats the exact same tool call and reminds it to change approach or finish, so a stuck loop stops burning time and tokens. `timeout-policy` puts a time limit on tool calls that declare one, so a hung call returns a clear timed-out error to the model instead of stalling the session. `budget-guard` bounds a whole turn by steps, tokens, wall-clock time, and session turns, stopping at a step boundary with a durable record when a limit is exceeded. `auto-resume` turns that stop into a continuation: when a task is still active with a handoff, it queues one more turn instead of waiting for a human. All four ship in the `dsh` base bundle; a composition can tune or remove them.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each README below explains when to keep, tune, or remove the plugin.

| Package | What it provides |
|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Reminds the model when it repeats the same tool call, so it changes approach or finishes |
| [`timeout-policy/`](timeout-policy/README.md) | Times out tool calls that declare a limit, so the model gets a clear error instead of waiting forever |
| [`budget-guard/`](budget-guard/README.md) | Stops a runaway turn at a step boundary when its step, token, wall-clock, or turn budget is exhausted |
| [`auto-resume/`](auto-resume/README.md) | Resumes an active task with a handoff after a budget stop or crash interruption, within a bounded attempt count |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the tools subsystem reference for the tool-call pipeline, then the reminder's configuration and the timeout-library decision behind the policy.

- [Tools subsystem reference](../../docs/subsystems/tools.md) — the tool-call pipeline and decisions the guards build on.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) — every accepted field of the repeat-call reminder.
- [Timeout deadline library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) — the timing/termination split `timeout-policy` enforces.
- [Long-task durability Agent Note](../../.agents/notes/implemented/feature/2026-10-19-long-task-durability.md) — why a turn budget sits beside the task snapshot.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
