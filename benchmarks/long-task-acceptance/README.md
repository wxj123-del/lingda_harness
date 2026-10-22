# Long-task acceptance benchmark

English | [中文](README.zh.md)

## Summary

This benchmark answers one question: do the long-task mechanisms fire? It is a mechanism regression probe, not a model capability evaluation — the model replays a fixed script, so a failure names the harness rather than the model.

Three scenarios run through the real agent loop, real tools, real guards, and real projections in an isolated process:

| Scenario | Script | What it proves |
|---|---|---|
| `false-success` | create a task → claim completion with no evidence → run the command → record it → complete | The evidence gate refuses a claim before the re-verification phase ever runs |
| `budget-resume` | create a task with a handoff → burn the step budget → automatic resume → prove and complete | A budget stop becomes a continuation from durable state |
| `crash-resume` | seed a log whose last turn never closed → resume the agent → automatic resume → complete | The repair path closes the tail as `interrupted` and the work continues |

## Run

```sh
cd deepseek-harness
pnpm run build:bench
pnpm exec vitest run --config vitest.bench.config.ts benchmarks/long-task-acceptance/long-task-acceptance.bench.ts
```

Each scenario prints one JSON line:

```json
{"scenario":"budget-resume","ok":true,"turns":2,"resumes":1,"budgetStops":1,"totalMs":54}
```

## What CI judges

Only `ok`, `turns`, `resumes`, and `budgetStops`. There is deliberately no time budget: the question is whether a mechanism fired, and a wall-clock threshold would make the gate flaky across machines. `totalMs` is recorded for diagnosis only.

## Reading a failure

- `task status active` — the completion gate refused the last claim, or the scripted replies ran out before the task completed.
- `turns N != M` — something drove an extra turn (a resume fired when it should not have) or a turn never opened.
- `resumes N != M` — the continuation guard declined, usually because the task had no handoff or a goal was armed.
- `budgetStops N != M` — the step cap was set above or below what the turn actually spends.

## Known Limitations and Deferred Work

- **Scripted model only** — real-model success rates are a different benchmark and are not measured here.
- **Fixture shell** — the `bash` tool always exits zero, so the benchmark proves the wiring, not command semantics.
- **No compaction in the scenarios** — the interaction between a resume and a compaction checkpoint is covered by the task-state compaction-survival test instead.
