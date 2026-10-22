/**
 * The three long-task acceptance scenarios, as fixed scripted model responses.
 *
 * Each scenario is a mechanism regression probe, not a model capability test:
 * the script decides exactly what the model "does", so a failure names the
 * harness rather than the model.
 */

/**
 * One scripted assistant reply, in the order the model produces them. A reply
 * with a call continues the turn; a reply without one ends it, because the loop
 * treats "no tool calls" as completion.
 */
export interface ScriptedReply {
  /** Text the model says alongside any call. */
  text?: string
  /** Tool call the model requests, if any. */
  call?: { id: string; name: string; arguments: Record<string, unknown> }
}

/** One scenario: a name, its replies, and what the run must prove. */
export interface Scenario {
  name: 'false-success' | 'budget-resume' | 'crash-resume'
  replies: ScriptedReply[]
  /** Expected automatic resumes. */
  resumes: number
  /** Expected tool-level budget stops. */
  budgetStops: number
  /** Expected turns that opened. */
  turns: number
  /** Whether the final task must be `succeeded`. */
  completes: boolean
}

const CREATE_SHIPPED: ScriptedReply = {
  call: {
    id: 'create',
    name: 'task_update',
    arguments: {
      objective: 'Ship the acceptance scenario',
      acceptance: ['the suite passes'],
      handoff: 'Run npm test, record it, then complete',
    },
  },
}

/** A scripted bash call the fixture answers with exit code zero. */
function runTests(id: string): ScriptedReply {
  return { call: { id, name: 'bash', arguments: { command: 'npm test' } } }
}

/** Record the passing command against criterion 1. */
function recordEvidence(id: string): ScriptedReply {
  return {
    call: {
      id,
      name: 'task_update',
      arguments: {
        evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] }],
      },
    },
  }
}

function say(text: string): ScriptedReply {
  return { text }
}

/**
 * `false-success`: the model claims completion with no evidence at all, is
 * refused, then runs the command and completes. Proves the evidence gate fires
 * before the re-verification phase.
 */
const falseSuccess: Scenario = {
  name: 'false-success',
  replies: [
    CREATE_SHIPPED,
    { call: { id: 'premature', name: 'task_update', arguments: { status: 'succeeded' } } },
    runTests('run'),
    recordEvidence('record'),
    { call: { id: 'complete', name: 'task_update', arguments: { status: 'succeeded' } } },
    say('complete'),
    // Spare replies: a second turn would consume them and show up in `turns`.
    say('spare-1'),
    say('spare-2'),
  ],
  resumes: 0,
  budgetStops: 0,
  turns: 1,
  completes: true,
}

/**
 * `budget-resume`: the first turn burns its step budget on bookkeeping, the
 * budget guard stops it, auto-resume continues from the handoff, and the second
 * turn proves the command and completes.
 */
const budgetResume: Scenario = {
  name: 'budget-resume',
  replies: [
    CREATE_SHIPPED,
    { call: { id: 'plan-1', name: 'task_update', arguments: { decision: 'planning' } } },
    { call: { id: 'plan-2', name: 'task_update', arguments: { decision: 'planning more' } } },
    // Turn two, reached through the automatic resume:
    runTests('run'),
    recordEvidence('record'),
    { call: { id: 'complete', name: 'task_update', arguments: { status: 'succeeded' } } },
    say('complete'),
    // Spare replies so a runaway resume shows up as extra turns, not an error.
    say('spare-1'),
    say('spare-2'),
  ],
  resumes: 1,
  budgetStops: 1,
  turns: 2,
  completes: true,
}

/**
 * `crash-resume`: the log is seeded with a task and an unclosed turn, the agent
 * resumes, the repair path closes the tail as `interrupted`, and auto-resume
 * drives exactly one continuation that completes the task.
 */
const crashResume: Scenario = {
  name: 'crash-resume',
  replies: [
    runTests('run'),
    recordEvidence('record'),
    { call: { id: 'complete', name: 'task_update', arguments: { status: 'succeeded' } } },
    say('complete'),
    say('spare-1'),
    say('spare-2'),
  ],
  resumes: 1,
  budgetStops: 0,
  // Two seeded turns (one completed, one interrupted) plus the resumed one.
  turns: 3,
  completes: true,
}

/** Every scenario, in execution order. */
export const SCENARIOS: readonly Scenario[] = [falseSuccess, budgetResume, crashResume]

/** Per-step budget the `budget-resume` scenario runs under. */
export const BUDGET_RESUME_MAX_STEPS = 4

/** Attempt cap every scenario runs under; above the expected count on purpose. */
export const MAX_AUTO_RESUMES = 4
