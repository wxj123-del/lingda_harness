# Workflow

English | [中文](workflow.zh.md)

The workflow seam lets an agent run a model-written orchestration SCRIPT that starts subagents. Like [subagent](subagent.md) it is **one optional capability**, not part of the agent loop, so its types and operations live here rather than in [core.md](core.md). Like bash, it permits ONE engine implementation per context to provide `ctx.workflowEngine`; there is no named-provider registry (a second engine replaces the first through plugin configuration rather than running beside it).

Service Definition: [dsh-workflow](../../packages/workflow/workflow) (`ctx.workflowEngine` and the vocabulary below). [dsh-workflow-ptc](../../packages/workflow/workflow-ptc) executes the VM and helpers through the shared Node PTC process runtime under the calling Session's file policy. The consumers are [dsh-tool-workflow](../../packages/workflow/tool-workflow) and the opt-in [dsh-tool-ralph](../../packages/workflow/tool-ralph). [Workflow sandbox reuse](../../.agents/notes/implemented/architecture/2026-09-13-workflow-ptc-sandbox-reuse.md) owns execution choices; the [dynamic-workflows decision](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md) owns script semantics.

Sources: browser-safe vocabulary in [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts), Host request and live-run handles in [`runtime-types.ts`](../../packages/workflow/workflow/src/runtime-types.ts).

## The start request

What a caller asks for when starting a run. The ordinary workflow tool builds this from the model's `{ script, meta, args }` call plus the calling agent; specialized consumers may also select one engine-wide `subagentProvider` and lower `maxTotalAgents` for the run, but the script cannot observe or replace either policy. `meta` and `args` are plain JSON DATA (the engine validates `meta` against its schema and rejects loud BEFORE anything runs — no script text is ever evaluated to obtain it). `parent` is REQUIRED — every child the script starts is attributed to it, and cwd, lineage, and depth pass through the [subagent seam](subagent.md).

```ts type-equiv
/**
 * What a caller asks for when starting a workflow run. `meta` and `args` are
 * plain JSON data by the seam contract. `parent` is required because every
 * `agent()` spawned by the script is attributed to that live Agent.
 */
interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** Enable trusted visual-node audit bindings for compiler-generated workflows. */
  nodeAudit?: boolean
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
}
```

## The workflow's identity: `WorkflowMeta`

The identity block carried as data on the start request (the tool's `meta` parameter; the field vocabulary matches the Claude Code dynamic-workflows meta block). `phases` is progress vocabulary only: `phase()` calls match titles for observers; no execution structure is implied.

```ts type-equiv
/**
 * The script's identity block, provided as plain JSON data alongside the
 * script body (the model-facing tool carries it as its `meta` parameter) and
 * validated by the engine before the body runs. `name`/`description` are
 * required; the rest is optional annotation. The field vocabulary matches the
 * Claude Code dynamic-workflows meta block.
 */
interface WorkflowMeta {
  /** Short kebab-case workflow name (display + persistence key). */
  name: string
  /** One-line description of what the workflow does. */
  description: string
  /** Optional guidance on when this workflow applies (shown in listings). */
  whenToUse?: string
  /** Optional phase declarations matched by `phase()` calls. */
  phases?: WorkflowPhase[]
}
```

## The terminal result: `WorkflowResult`

The outcome of one run, resolved by `WorkflowRun.result`. `value` is the script's materialized return value — plain host-realm JSON data (`null` when the script returned nothing) — meaningful only for `completed`. `stopReason` is a CLOSED union (engine-owned; consumers may exhaust it): `completed` | `cancelled` | `error`. A non-`completed` reason carries the failure in `error`, and the consumer maps it to an `isError` tool result rather than reporting partial output as success.

```ts type-equiv
/**
 * The outcome resolved by a live workflow run. `value` is
 * the script's materialized return value (plain host-realm JSON data; `null`
 * when the script returned `undefined`) — meaningful only for `completed`.
 * A non-`completed` reason carries the failure in `error`; the consumer maps
 * it to an `isError` tool result rather than reporting partial output.
 */
interface WorkflowResult {
  /** The script's return value (host JSON data; `null` for no return). */
  value: unknown
  /** Why the run settled. */
  stopReason: WorkflowStopReason
  /** The failure message (present iff `stopReason` is not `completed`). */
  error?: string
  /**
   * How many `agent()` calls the run accepted over its whole lifetime. On a
   * graceful settlement this is the script-side count (calls still queued for
   * a concurrency slot included); on a termination path (cancellation or
   * process failure) it degrades to the host-observed count — calls queued
   * inside a terminated script are unknowable then.
   */
  agentsStarted: number
}
```

## A live run: `WorkflowRun`

The consumer awaits `result`, may `cancel` during execution, and must `dispose` on every path. `result` never rejects: script failure resolves with `stopReason: 'error'`, and cancellation with `'cancelled'`. The PTC engine has no overall elapsed deadline; it immediately aborts the managed process when cancelled. Disposal awaits process and child cleanup under their provider contracts, without an independent workflow cleanup deadline.

```ts type-equiv
/**
 * Holder-owned live workflow. `result` never rejects; consumers may cancel
 * and must call idempotent `dispose()` to await script and child quiescence.
 */
interface WorkflowRun {
  readonly id: WorkflowRunId
  /** The validated meta block available before the script body runs. */
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>
  /** Cancel the run and its children. */
  cancel(reason?: string): void
  /** Cancel if needed and await script and child cleanup. */
  dispose(): Promise<void>
}
```

## Failure discipline: `WorkflowError.fatal`

Hook misuse inside a script — bad arguments, unknown/deferred `agent()` options, a schema outside the [structured-output subset](../../packages/core/tools/README.md), a tripped cap, a seam start failure, cancellation — throws a `WorkflowError` with `fatal: true`. The `parallel()`/`pipeline()` combinators RE-THROW fatal errors instead of mapping the item to `null`: a typo'd option must kill the script loudly, never dissolve into something that reads as an ordinary child failure. The per-item `null` is reserved for child-run failures (a non-`completed` stop reason) and ordinary in-stage script errors.

## Events

The `workflow/*` events (`workflow/start`, `workflow/phase`, `workflow/log`, `workflow/agent-start`, `workflow/agent-end`, `workflow/end` — see the [events catalog](#cordis-surface)) are **observe-only** emits carrying DATA SNAPSHOTS: every payload starts with `WorkflowRunInfo` (id + meta), never the live `WorkflowRun`, so a subscriber cannot gain `cancel`/`dispose`, and `workflow/end` deliberately omits the result value (a listener observing outcomes must not receive a mutable alias of the caller's result). Every emit is per-listener contained — a throwing subscriber is logged, never propagated, and cannot starve the listeners registered after it — and every listener receives its own payload clone, so mutating it corrupts neither the engine nor other listeners; the containment mirrors `subagent/start`/`subagent/end`.

## Durable Chat records

The top-level `dsh-tool-workflow` consumer projects display facts into its calling parent Session without changing execution ownership. It writes `tool-workflow/run-start` after a run is accepted, pairs member start and end by `runId + seq`, and writes `tool-workflow/run-end` only after the result is known and disposal reaches quiescence. Nested transport calls write no record. The first append failure disables later writes for that run, so the log remains empty or a legal continuous prefix and the tool result is unchanged.

`dsh-tool-workflow/invariant` validates the same protocol before live commit and when a Session is loaded: one start per run, positive unique member sequences, paired member endings, no run ending with open members, and no updates after the run ending. A missing member ending or run ending at the log tail is valid interruption evidence rather than corruption.

`dsh-client-ui-workflow-run` folds the four events through the Conversation Node engine into one `workflow-run` Chat node anchored at the run-start sequence, after the original workflow tool node. Phase groups come only from actual member starts and preserve exact strings, including the distinction between an omitted phase and `''`. Closed Locations turn missing terminal facts into interrupted presentation. The [UI package README](../../packages/client/ui-workflow-run/README.md) owns disclosure, status, and same-parent local navigation behavior.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkflowengine--workflowengine-abstract-seam"></a>

### `ctx.workflowEngine` — `WorkflowEngine` (abstract seam)

Workflow Service Definition contract. Invalid requests throw before publication; a live run is holder-owned, its result never rejects, and disposal waits for script and child cleanup. Lifecycle listener failures are contained, and `workflow/end` fires exactly once as the result settles.

```ts cordis-catalog
/**
 * Parse and execute a workflow script.
 * @param request - the script, its `args`, the parent agent, and an
 *   optional cancel signal.
 * @returns the live run; its `result` resolves when the script settles.
 */
abstract start(request: WorkflowStartRequest): WorkflowRun
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflow-events"></a>

### `workflow/*` events

<a id="workflowagent-end--emit"></a>

#### `workflow/agent-end` — emit

One child Agent run settled.

```ts cordis-catalog
/**
 * One child Agent run settled.
 * @param info - The workflow run identity snapshot.
 * @param agent - The child call identity and outcome.
 * @mode emit
 */
'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void
```

Source: [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts)

<a id="workflowagent-start--emit"></a>

#### `workflow/agent-start` — emit

One child Agent run started.

```ts cordis-catalog
/**
 * One child Agent run started.
 * @param info - The workflow run identity snapshot.
 * @param agent - The child call identity.
 * @mode emit
 */
'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void
```

Source: [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts)

<a id="workflowend--emit"></a>

#### `workflow/end` — emit

A workflow run settled.

```ts cordis-catalog
/**
 * A workflow run settled.
 * @param info - The workflow run identity snapshot.
 * @param result - The result metadata without the mutable result value.
 * @mode emit
 */
'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void
```

Source: [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts)

<a id="workflowlog--emit"></a>

#### `workflow/log` — emit

The script emitted one narration line.

```ts cordis-catalog
/**
 * The script emitted one narration line.
 * @param info - The run identity snapshot.
 * @param message - The emitted text.
 * @mode emit
 */
'workflow/log'(info: WorkflowRunInfo, message: string): void
```

Source: [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts)

<a id="workflownode-end--emit"></a>

#### `workflow/node-end` — emit

A visual workflow node reached a terminal state.

```ts cordis-catalog
/**
 * A visual workflow node reached a terminal state.
 * @param info - The workflow run identity snapshot.
 * @param node - The node terminal observation.
 * @mode emit
 */
'workflow/node-end'(info: WorkflowRunInfo, node: WorkflowNodeEndInfo): void
```

Source: [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts)

<a id="workflownode-start--emit"></a>

#### `workflow/node-start` — emit

A visual workflow node began execution.

```ts cordis-catalog
/**
 * A visual workflow node began execution.
 * @param info - The workflow run identity snapshot.
 * @param node - The node start observation.
 * @mode emit
 */
'workflow/node-start'(info: WorkflowRunInfo, node: WorkflowNodeStartInfo): void
```

Source: [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts)

<a id="workflowphase--emit"></a>

#### `workflow/phase` — emit

The script entered a progress phase.

```ts cordis-catalog
/**
 * The script entered a progress phase.
 * @param info - The run identity snapshot.
 * @param title - The exact phase title.
 * @mode emit
 */
'workflow/phase'(info: WorkflowRunInfo, title: string): void
```

Source: [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts)

<a id="workflowstart--emit"></a>

#### `workflow/start` — emit

A workflow run started; paired with Events['workflow/end'].

```ts cordis-catalog
/**
 * A workflow run started; paired with {@link Events['workflow/end']}.
 * @param info - The run identity snapshot.
 * @mode emit
 */
'workflow/start'(info: WorkflowRunInfo): void
```

Source: [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts)
<!-- END GENERATED cordis-surface -->
