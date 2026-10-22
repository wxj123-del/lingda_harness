---
description: "Runtime turn budgets that stop a runaway agent turn at a step boundary: step, token, wall-clock, and session-wide turn limits with a soft handoff warning, for users and maintainers configuring long sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-budget-guard

English | [中文](README.zh.md)

## Summary

`dsh-budget-guard` puts a hard ceiling on a single agent turn. It counts model steps, provider-reported tokens, elapsed wall-clock time, and total session turns; when a configured limit is exceeded it stops the turn at the next step boundary and appends a durable `budget/stop` record naming the limit and the observed value. Before the limit, one advisory warning asks the model to record how to resume. Omitting a limit leaves it unbounded, so a deployment opts into each ceiling it wants.

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

Mount the guard when an agent may run unattended and a runaway loop must end by policy rather than by luck. The `dsh` base bundle mounts it with every limit unset, so nothing changes until a deployment configures one.

### When to choose it

Choose it for autonomous or scheduled work where cost and time must be bounded. Avoid it on purely interactive sessions where a human watches every turn: the per-turn step limits duplicate the personal-agent mode caps, and a wall-clock ceiling can cut off a legitimately slow long tool call.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-budget-guard'
  config:
    maxStepsPerTurn: 40
    maxTurns: 200
    maxTokensPerTurn: 200000
    maxWallClockMsPerTurn: 1800000
    warnAtRatio: 0.8
```

| Field | Default | Meaning |
|---|---|---|
| `maxStepsPerTurn` | unset | Model steps in one turn; the turn stops before step `limit + 1` |
| `maxTurns` | unset | Total turns; a new turn past the limit is rejected before any model call |
| `maxTokensPerTurn` | unset | Sum of provider-reported input and output tokens in one turn |
| `maxWallClockMsPerTurn` | unset | Elapsed time from the turn's first step |
| `warnAtRatio` | `0.8` | Fraction of any limit at which one handoff warning is injected; `1` disables it |

Invalid configuration fails at load: a limit that is not a positive safe integer, or a ratio outside `0.1`–`1`, throws rather than falling back.

### What you get

When a limit is exceeded the turn ends with `turn/end { kind: 'blocked' }` and one `budget/stop` event records `{ turn, reason, limit, observed }`. The session stays usable: the next turn starts a fresh counter, and a task `handoff` written before the stop tells the next turn where to resume.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Stop at a boundary, never mid-step.** The check runs in `agent/pre-step`, so a rejected step leaves no partial request and no half-applied tool batch.
- **Durable, not in-memory.** The stop is a session event, so a resumed session shows why the turn ended.
- **Opt in per limit.** Unset means unbounded; a composition cannot accidentally inherit a cost ceiling it did not choose.
- **Warn once.** A single soft warning at `warnAtRatio` asks for a handoff without spamming every later step.

### Counting

Steps and turns come from the `agent/pre-step` payload. Tokens accumulate from `assistant/message` usage samples for the current turn, deduplicated by turn. Wall-clock time starts when the turn's first step is evaluated.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Policy validation, counters, pre-step evaluation, warning injection |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Guard group map](../README.md) — the sibling loop-hygiene guards.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-budget-guard) — every accepted field.
- [Personal agent modes](../../interaction/personal-agent/README.md) — the per-mode step caps this guard complements.

-----

<a id="model-experience"></a>
## Model Experience

### Prompt section

#### What the model sees

A two-sentence standing instruction: budgets may stop the turn at a step boundary, and a budget warning means record what remains and how to resume it.

#### Token effect

Fixed; two sentences per request.

#### KV Cache effect

Prefix-stable while the mounted composition is unchanged.

### Budget warning

#### What the model sees

At most once per turn, when any configured limit reaches `warnAtRatio`, the plugin-sourced notice below.

##### Budget warning

```markdown
<budget_warning>
Approaching the turn budget (<steps n/max>, <tokens ~n/max>, <wall-clock ns/maxs>). If the objective is not yet complete, record the remaining work and how to resume it — a task handoff, a file, or a decision note — because the turn may stop at the next step boundary.
</budget_warning>
```

#### Token effect

One short message per turn at most.

#### KV Cache effect

Append-only; it follows the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Per-turn, not per-session, for steps and tokens** — counters reset every turn; only `maxTurns` bounds the whole session.
- **Tokens are provider-reported** — a provider that omits usage on an attempt leaves that attempt uncounted.
- **Wall-clock measures between pre-step evaluations** — a single very long tool call is observed only when the next step begins.
- **No cost or currency budget** — limits are steps, tokens, turns, and time; provider pricing is not applied.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is explicitly non-authoritative. The [task-state Agent Note](../../../.agents/notes/implemented/feature/2026-10-19-long-task-durability.md) records the rationale.

</details>
