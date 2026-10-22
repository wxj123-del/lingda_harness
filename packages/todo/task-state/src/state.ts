/**
 * Pure task-snapshot mutations and model-facing rendering. No host services and
 * no durable writes: `apply()` owns the append, so every rule here is testable
 * against a plain snapshot.
 * @module @deepseek-ai/dsh-task-state/state
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  TaskEvidence,
  TaskEvidenceKind,
  TaskEvidenceStatus,
  TaskState,
  TaskStatus,
} from './types.ts'

/** Upper bound on retained evidence records; the oldest auto records drop first. */
export const MAX_EVIDENCE = 40

/** Upper bound on retained decisions. */
export const MAX_DECISIONS = 20

const EVIDENCE_KINDS: readonly TaskEvidenceKind[] = ['command', 'test', 'file', 'manual']
const EVIDENCE_STATUSES: readonly TaskEvidenceStatus[] = ['pass', 'fail', 'unknown']
const TASK_STATUSES: readonly TaskStatus[] = ['active', 'blocked', 'succeeded', 'cancelled']

/** Model-supplied evidence entry; ids and timestamps are assigned by the store. */
export interface EvidenceInput {
  kind: TaskEvidenceKind
  ref: string
  status: TaskEvidenceStatus
  acceptance?: number[]
}

/** One partial update to the current task snapshot. */
export interface TaskPatch {
  objective?: string
  /** Acceptance criteria to append; existing criteria keep their positions. */
  acceptance?: string[]
  evidence?: EvidenceInput[]
  decision?: string
  handoff?: string
  status?: TaskStatus
}

/** Whether a value is one of this domain's evidence kinds. */
export function isEvidenceKind(value: unknown): value is TaskEvidenceKind {
  return typeof value === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(value)
}

/** Whether a value is one of this domain's evidence statuses. */
export function isEvidenceStatus(value: unknown): value is TaskEvidenceStatus {
  return typeof value === 'string' && (EVIDENCE_STATUSES as readonly string[]).includes(value)
}

/** Whether a value is one of this domain's task statuses. */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

function trimmedNonEmpty(value: string, field: string): string {
  const text = value.trim()
  if (text.length === 0) {
    throw new HarnessError(`${field} must be a non-empty string`, 'TASK_INVALID_INPUT')
  }
  return text
}

/** Append new acceptance criteria, dropping duplicates and preserving prior positions. */
function appendAcceptance(current: readonly string[], additions: readonly string[]): string[] {
  const next = [...current]
  for (const raw of additions) {
    const text = trimmedNonEmpty(raw, 'acceptance item')
    if (!next.includes(text)) next.push(text)
  }
  return next
}

/** Validate one evidence entry against the current acceptance list. */
function normalizeEvidence(
  input: EvidenceInput,
  acceptanceCount: number,
  id: string,
  at: number,
  auto?: true,
): TaskEvidence {
  const ref = trimmedNonEmpty(input.ref, 'evidence ref')
  const covered = input.acceptance ?? []
  for (const index of covered) {
    if (!Number.isSafeInteger(index) || index < 1 || index > acceptanceCount) {
      throw new HarnessError(
        `evidence acceptance index ${String(index)} is outside 1..${String(acceptanceCount)}`,
        'TASK_INVALID_EVIDENCE',
      )
    }
  }
  return {
    id,
    kind: input.kind,
    ref,
    status: input.status,
    acceptance: [...new Set(covered)].sort((left, right) => left - right),
    at,
    ...auto === true ? { auto: true as const } : {},
  }
}

/** Append one record, dropping the oldest automatic record once the cap is reached. */
function appendEvidence(current: readonly TaskEvidence[], record: TaskEvidence): TaskEvidence[] {
  const next = [...current, record]
  while (next.length > MAX_EVIDENCE) {
    const oldestAuto = next.findIndex(item => item.auto === true)
    next.splice(oldestAuto === -1 ? 0 : oldestAuto, 1)
  }
  return next
}

/** Acceptance indices still lacking a passing evidence record, 1-based. */
export function uncoveredAcceptance(task: TaskState): number[] {
  const covered = new Set<number>()
  for (const record of task.evidence) {
    if (record.status !== 'pass') continue
    for (const index of record.acceptance) covered.add(index)
  }
  return task.acceptance
    .map((_text, index) => index + 1)
    .filter(index => !covered.has(index))
}

/** Whether one index has a passing evidence record. */
export function isCovered(task: TaskState, index: number): boolean {
  return task.evidence.some(record => record.status === 'pass' && record.acceptance.includes(index))
}

/**
 * Normalize one command line for comparison: collapse whitespace and trim, so a
 * log entry and an evidence ref that differ only in spacing still match.
 */
export function normalizeCommand(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/** One successful observation of a file's content, recovered from the session log. */
export interface FileFact {
  /** Tool that read it (`read`, `grep`, …). */
  name: string
  /** Absolute or workspace-relative path the tool was asked for. */
  path: string
}

/** One successful shell invocation recovered from the session log. */
export interface ShellFact {
  /** Tool name (`bash` or `pwsh`). */
  name: string
  /** The exact command argument the model sent. */
  command: string
  /** Exit code the executor reported; only zero counts as success. */
  exitCode: number | null
  /**
   * The complete argument object the tool accepted, so a re-run satisfies the
   * same schema (`bash` requires a `description`, for example).
   */
  arguments?: Record<string, unknown>
}

/**
 * Whether one passing record is backed by something the harness observed rather
 * than by the model's assertion. An automatic record is observed by
 * construction; a record naming a command is verified only when the session log
 * holds a successful shell call with that command.
 * @param record - one evidence record.
 * @param facts - successful shell calls recovered from the session log.
 * @returns whether the record is verified.
 */
export function isVerifiedEvidence(
  record: TaskEvidence,
  facts: readonly ShellFact[],
  fileFacts: readonly FileFact[] = [],
): boolean {
  if (record.status !== 'pass') return false
  if (record.auto === true) return true
  if (record.kind === 'file') return observedFile(record.ref, fileFacts) !== undefined
  if (record.kind !== 'command' && record.kind !== 'test') return false
  return observedCommand(record.ref, facts) !== undefined
}

/**
 * The read that backs one claimed file, if any. A `file` record names a path (it
 * may add a description after it); the session is trusted only when a read of
 * that exact path succeeded.
 * @param ref - the model's claimed path, optionally followed by detail.
 * @param files - successful file reads recovered from the session log.
 * @returns the observing fact, or undefined.
 */
export function observedFile(ref: string, files: readonly FileFact[]): FileFact | undefined {
  const wanted = normalizeCommand(ref)
  if (wanted.length === 0) return undefined
  return files.find((fact) => {
    const path = normalizeCommand(fact.path)
    if (path.length === 0) return false
    return wanted === path || wanted.startsWith(`${path} `) || wanted.startsWith(`${path}:`)
      || wanted.includes(path)
  })
}

/**
 * The successful observation backing one claimed command, if any.
 *
 * Matching is deliberately tolerant, because the model writes the `ref` by hand
 * while the observer stores what actually ran: a `ref` that contains the whole
 * observed command, or that the observed command contains, names the same work.
 * The direction still matters — a `ref` must cover the observed command rather
 * than a fragment of it — so a short decorative string cannot claim a run it
 * did not describe.
 * @param ref - the model's claimed command text.
 * @param facts - successful shell calls recovered from the session log.
 * @returns the observing fact, or undefined.
 */
export function observedCommand(
  ref: string,
  facts: readonly ShellFact[],
): ShellFact | undefined {
  const wanted = normalizeCommand(ref)
  if (wanted.length === 0) return undefined
  return facts.find((fact) => {
    if (fact.exitCode !== 0) return false
    const observed = normalizeCommand(fact.command)
    if (observed === wanted) return true
    // The ref quotes the run (or the run quotes the ref, e.g. the ref drops a
    // trailing `; echo EXIT=$?` the model appended).
    return wanted.includes(observed) || observed.includes(wanted)
  })
}


/**
 * The evidence supporting each criterion: for every 1-based acceptance index,
 * the newest passing record that covers it. Records covering no criterion are
 * omitted, which is how an exploratory automatic record stops mattering.
 * @param task - the current snapshot.
 * @returns the winning records, in the snapshot's original order.
 */
export function latestCoveringEvidence(task: TaskState): TaskEvidence[] {
  const newest = new Map<number, TaskEvidence>()
  for (const record of task.evidence) {
    if (record.status !== 'pass') continue
    for (const index of record.acceptance) {
      const current = newest.get(index)
      if (current === undefined || record.at >= current.at) newest.set(index, record)
    }
  }
  const winners = new Set(newest.values())
  return task.evidence.filter(record => winners.has(record))
}

/** One command that must be re-run before completion, with the tool that ran it. */
export interface ReverifiableCommand {
  name: string
  command: string
  /** Complete arguments to replay; defaults to `{ command }` when unknown. */
  arguments?: Record<string, unknown>
}

/**
 * Distinct verified commands backing the current snapshot's evidence, in first
 * occurrence order. Only records the log already backs are returned, so a model
 * cannot introduce a new command at completion time.
 * @param task - the current snapshot.
 * @param facts - successful shell calls recovered from the session log.
 * @returns one entry per distinct command, named by the tool that ran it.
 */
export function reverifiableCommands(
  task: TaskState,
  facts: readonly ShellFact[],
  options: { latestOnly?: boolean } = {},
): ReverifiableCommand[] {
  const seen = new Set<string>()
  const result: ReverifiableCommand[] = []
  // Completion re-runs what the *current* claim rests on. Evidence accumulates
  // across attempts, so replaying every historical record would keep gating on
  // commands the model has since replaced or that no longer apply.
  const records = options.latestOnly === true
    ? latestCoveringEvidence(task)
    : task.evidence
  for (const record of records) {
    // Only evidence that actually backs a criterion is worth re-running. An
    // automatic record carries no acceptance indices: it documents that a
    // command ran, not that it proves anything, so re-running it would gate
    // completion on incidental exploration (`ls`, `cat`, a version check).
    if (record.acceptance.length === 0) continue
    // Only shell-backed evidence is re-runnable; a `file` record is proven by a
    // read, not by executing anything.
    if (record.kind !== 'command' && record.kind !== 'test') continue
    if (!isVerifiedEvidence(record, facts)) continue
    const fact = observedCommand(record.ref, facts)
    // An automatic record is verified by construction but may have no usable
    // command text; skip those rather than invent one.
    if (fact === undefined) continue
    const key = normalizeCommand(fact.command)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      name: fact.name,
      command: fact.command,
      ...fact.arguments === undefined ? {} : { arguments: fact.arguments },
    })
  }
  return result
}

/** Acceptance indices with passing evidence that only the model asserts, 1-based. */
export function unverifiedAcceptance(
  task: TaskState,
  facts: readonly ShellFact[],
  fileFacts: readonly FileFact[] = [],
): number[] {
  const verified = new Set<number>()
  for (const record of task.evidence) {
    if (!isVerifiedEvidence(record, facts, fileFacts)) continue
    for (const index of record.acceptance) verified.add(index)
  }
  return task.acceptance
    .map((_text, index) => index + 1)
    .filter(index => !verified.has(index))
}

/**
 * Apply one patch and return a fresh snapshot. Creating the first task is the
 * same operation with no current snapshot; `succeeded` is rejected while any
 * acceptance criterion lacks passing evidence.
 * @param current - the latest snapshot, or null before the first write.
 * @param patch - the validated model request.
 * @param at - epoch milliseconds stamped on the snapshot and new records.
 * @returns the next complete snapshot.
 */
export function applyTaskPatch(
  current: TaskState | null,
  patch: TaskPatch,
  at: number,
  policy: CompletionPolicy = {},
): TaskState {
  if (current === null) {
    const objective = patch.objective === undefined
      ? undefined
      : trimmedNonEmpty(patch.objective, 'objective')
    if (objective === undefined) {
      throw new HarnessError('creating a task requires objective', 'TASK_INVALID_INPUT')
    }
    const acceptance = appendAcceptance([], patch.acceptance ?? [])
    const evidence = (patch.evidence ?? []).map((input, index) =>
      normalizeEvidence(input, acceptance.length, `e${String(index + 1)}`, at))
    const next: TaskState = {
      revision: 1,
      objective,
      status: patch.status ?? 'active',
      acceptance,
      evidence,
      decisions: patch.decision === undefined
        ? []
        : [{ text: trimmedNonEmpty(patch.decision, 'decision'), at }],
      ...patch.handoff === undefined ? {} : { handoff: patch.handoff },
      createdAt: at,
      updatedAt: at,
    }
    assertSucceededCoverage(next, policy)
    return next
  }

  const objective = patch.objective === undefined
    ? current.objective
    : trimmedNonEmpty(patch.objective, 'objective')
  const acceptance = appendAcceptance(current.acceptance, patch.acceptance ?? [])
  let evidence = current.evidence
  for (const input of patch.evidence ?? []) {
    evidence = appendEvidence(evidence, normalizeEvidence(
      input,
      acceptance.length,
      `e${String(evidence.length + 1)}`,
      at,
    ))
  }
  const decisions = patch.decision === undefined
    ? current.decisions
    : [...current.decisions, { text: trimmedNonEmpty(patch.decision, 'decision'), at }]
      .slice(-MAX_DECISIONS)
  const next: TaskState = {
    ...current,
    revision: current.revision + 1,
    objective,
    status: patch.status ?? current.status,
    acceptance,
    evidence,
    decisions,
    ...patch.handoff === undefined ? {} : { handoff: patch.handoff },
    updatedAt: at,
  }
  assertSucceededCoverage(next, policy)
  return next
}

/** One completion policy for a patch: whether asserted evidence may cover a criterion. */
export interface CompletionPolicy {
  /**
   * When true, every criterion must be covered by observed evidence: an
   * automatic record, or a command the session log shows succeeding. When
   * false, any passing record covers it.
   */
  requireVerifiedEvidence?: boolean
  /** Successful shell calls recovered from the session log, used by the stricter check. */
  shellFacts?: readonly ShellFact[]
  /** Successful file reads recovered from the session log. */
  fileFacts?: readonly FileFact[]
}

/**
 * Reject completion while an acceptance criterion has no passing evidence, and
 * — under the stricter policy — while a criterion is covered only by an
 * unobserved assertion.
 */
function assertSucceededCoverage(task: TaskState, policy: CompletionPolicy = {}): void {
  if (task.status !== 'succeeded') return
  if (task.acceptance.length === 0) {
    throw new HarnessError(
      'cannot mark the task succeeded without acceptance criteria',
      'TASK_MISSING_ACCEPTANCE',
    )
  }
  const missing = uncoveredAcceptance(task)
  if (missing.length > 0) {
    throw new HarnessError(
      `cannot mark the task succeeded: acceptance ${missing.join(', ')} `
      + 'lack passing evidence; record evidence with acceptance indices first',
      'TASK_MISSING_EVIDENCE',
    )
  }
  if (policy.requireVerifiedEvidence !== true) return
  const unverified = unverifiedAcceptance(task, policy.shellFacts ?? [], policy.fileFacts ?? [])
  if (unverified.length === 0) return
  // Name what the session actually observed: a model cannot guess the exact
  // command text the observer stored, so the message has to supply it.
  const observed = [...new Set((policy.shellFacts ?? [])
    .filter(fact => fact.exitCode === 0)
    .map(fact => fact.command))]
  const hint = observed.length === 0
    ? 'No successful shell command has been observed in this session yet; run the verification '
      + 'command with the shell tool first.'
    : 'Reuse one of these observed commands verbatim as the evidence ref:\n'
      + observed.slice(-5).map(command => `- ${command}`).join('\n')
  throw new HarnessError(
    `cannot mark the task succeeded: acceptance ${unverified.join(', ')} `
    + `have only asserted evidence. ${hint}`,
    'TASK_UNVERIFIED_EVIDENCE',
  )
}

/** Append one automatic evidence record without touching any other field. */
export function appendAutoEvidence(
  current: TaskState,
  input: EvidenceInput,
  at: number,
): TaskState {
  const record = normalizeEvidence(
    input,
    current.acceptance.length,
    `e${String(current.evidence.length + 1)}`,
    at,
    true,
  )
  return {
    ...current,
    revision: current.revision + 1,
    evidence: appendEvidence(current.evidence, record),
    updatedAt: at,
  }
}

/** One-line coverage state for the model card. */
function acceptanceLine(task: TaskState, text: string, index: number): string {
  return isCovered(task, index)
    ? `  ${String(index)}. ${text} [covered]`
    : `  ${String(index)}. ${text} [MISSING EVIDENCE]`
}

/** Retained decisions rendered for the model card, newest last. */
function decisionLines(task: TaskState): string[] {
  return task.decisions.map(decision => `- ${decision.text}`)
}

/** Session-cumulative usage the card can report, named exactly as the meter's wire view. */
export interface CardProgress {
  /** Provider-reported uncached input tokens across the session. */
  uncachedInputTokens: number
  /** Provider-reported output tokens across the session. */
  outputTokens: number
  /** Provider-reported cache-read tokens across the session. */
  cacheReadTokens: number
}

/** One compact line naming what the session has spent so far. */
function progressLine(progress: CardProgress): string {
  const total = progress.uncachedInputTokens + progress.outputTokens
  const cached = progress.cacheReadTokens > 0
    ? `, ${progress.cacheReadTokens.toLocaleString('en-US')} cached`
    : ''
  return `Spent so far: ${total.toLocaleString('en-US')} tokens `
    + `(in ${progress.uncachedInputTokens.toLocaleString('en-US')}, `
    + `out ${progress.outputTokens.toLocaleString('en-US')}${cached})`
}

/**
 * Render the compact per-turn card injected at the start of every top-level
 * turn. Bounded so the card stays a small fixed addition to a request.
 * @param task - the current snapshot.
 * @param progress - session-cumulative usage, when a meter is mounted.
 * @returns the card text.
 */
export function renderTaskCard(task: TaskState, progress?: CardProgress): string {
  const objective = task.objective.length > 240
    ? `${task.objective.slice(0, 239)}…`
    : task.objective
  const lines = [
    '<task_state>',
    `Objective: ${objective}`,
    `Status: ${task.status} (revision ${String(task.revision)})`,
  ]
  if (progress !== undefined) lines.push(progressLine(progress))
  if (task.acceptance.length > 0) {
    lines.push('Acceptance:')
    lines.push(...task.acceptance.map((text, index) => acceptanceLine(task, text, index + 1)))
  }
  const failures = task.evidence.filter(record => record.status === 'fail').slice(-3)
  if (failures.length > 0) {
    lines.push('Recent failing evidence:')
    lines.push(...failures.map(record => `- ${record.kind}: ${record.ref}`))
  }
  if (task.decisions.length > 0) {
    lines.push('Decisions:')
    lines.push(...decisionLines(task).slice(-5))
  }
  if (task.handoff !== undefined && task.handoff.length > 0) {
    lines.push(`Handoff: ${task.handoff}`)
  }
  lines.push('</task_state>')
  return lines.join('\n')
}

/** Model-facing JSON view; evidence ids and revisions make updates addressable. */
export function taskView(task: TaskState | null): Record<string, JsonValue> {
  if (task === null) return { task: null }
  return {
    task: {
      revision: task.revision,
      objective: task.objective,
      status: task.status,
      acceptance: task.acceptance.map((text, index) => ({
        index: index + 1,
        text,
        covered: isCovered(task, index + 1),
      })),
      evidence: task.evidence.map(record => ({
        id: record.id,
        kind: record.kind,
        ref: record.ref,
        status: record.status,
        acceptance: record.acceptance,
        ...record.auto === true ? { auto: true } : {},
      })),
      uncovered: uncoveredAcceptance(task),
      ...task.handoff === undefined ? {} : { handoff: task.handoff },
    },
  }
}
