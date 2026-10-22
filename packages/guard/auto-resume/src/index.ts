/**
 * Automatic continuation after a stop that was not the model's decision. When a
 * turn ends on a runtime budget or a crash-interrupted tail, and the session's
 * task is still active with a handoff, this plugin queues one more turn so the
 * work resumes from durable state instead of waiting for a human nudge.
 *
 * It deliberately never competes with an armed goal (the goal driver owns
 * continuation there), never resumes a turn the user cancelled, and never
 * re-drives a turn that completed on its own.
 * @module @deepseek-ai/dsh-auto-resume
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-task-state/types'
import type { TaskState } from '@deepseek-ai/dsh-task-state/types'

/** Plugin name. */
export const name = 'auto-resume'
/**
 * Services the plugin reads. `goals` is optional by composition: a deployment
 * without the goal domain resumes without that guard.
 */
export const inject = ['agents', 'sessions', 'sessionProjections']

/** Deployment policy for automatic continuation. */
export interface Config {
  /** Maximum automatic resumes in one session. `0` disables the plugin's effect. */
  maxAutoResumes: number
  /** Minimum idle time before a resume fires, in milliseconds. */
  minIntervalMs: number
  /** Require a non-empty task handoff before resuming. */
  requireHandoff: boolean
  /** Resume after a turn that ended with an LLM error. */
  resumeOnError: boolean
}

/** Schemastery configuration schema. */
export const Config: z<Config> = z.object({
  maxAutoResumes: z.number().step(1).min(0).default(3),
  minIntervalMs: z.number().min(0).default(1000),
  requireHandoff: z.boolean().default(true),
  resumeOnError: z.boolean().default(false),
})

/** One durable record of an automatic resume. */
export interface AutoResumeAttempt {
  /** Why the previous turn stopped: `budget:<reason>`, `interrupted`, or `error`. */
  reason: string
  /** 1-based attempt number within the session. */
  attempt: number
  /** Task revision the resume was based on. */
  taskRevision: number
  /** Epoch milliseconds. */
  at: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One automatic continuation queued after a non-model stop. */
    'auto-resume/attempt': AutoResumeAttempt
  }
}

/** Live per-agent continuation state. */
interface ResumeState {
  budgetStop?: SessionEvent<'budget/stop'>['data'] | undefined
  lastEnd?: TurnEndReason | undefined
  attempts: number
  lastAt: number
  driving: boolean
}

/** Resolved policy after validation. */
interface ResolvedConfig {
  readonly maxAutoResumes: number
  readonly minIntervalMs: number
  readonly requireHandoff: boolean
  readonly resumeOnError: boolean
}

function resolveConfig(config: Config): ResolvedConfig {
  const maxAutoResumes = config.maxAutoResumes ?? 3
  if (!Number.isSafeInteger(maxAutoResumes) || maxAutoResumes < 0) {
    throw new TypeError('auto-resume: maxAutoResumes must be a non-negative safe integer')
  }
  const minIntervalMs = config.minIntervalMs ?? 1000
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new TypeError('auto-resume: minIntervalMs must be a non-negative number')
  }
  return {
    maxAutoResumes,
    minIntervalMs,
    requireHandoff: config.requireHandoff ?? true,
    resumeOnError: config.resumeOnError ?? false,
  }
}

/** Render the short continuation prompt; the task card is injected separately. */
function renderResumePrompt(reason: string, task: TaskState): string {
  const handoff = task.handoff ?? ''
  return '<auto_resume reason="' + reason + '">\n'
    + 'The previous turn stopped before the objective was complete (' + reason + ').\n'
    + 'Resume from this handoff instead of restarting completed work:\n\n'
    + handoff + '\n\n'
    + 'Re-read the task card, verify the current workspace state, then continue.\n'
    + '</auto_resume>'
}

/**
 * Install the continuation listeners.
 * @param ctx - plugin context; listeners and their state are disposed with it.
 * @param config - validated deployment policy.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const states = new WeakMap<Agent, ResumeState>()

  const stateFor = (agent: Agent): ResumeState => {
    let state = states.get(agent)
    if (state === undefined) {
      // A resumed Session must inherit its durable attempt history: a fresh
      // counter would let every restart spend the full budget again.
      state = { ...recoverAttempts(agent), driving: false }
      states.set(agent, state)
    }
    return state
  }

  /** Why the last turn deserves a continuation, or undefined when it does not. */
  function resumeReason(state: ResumeState): string | undefined {
    if (state.budgetStop !== undefined) return `budget:${state.budgetStop.reason}`
    if (state.lastEnd?.kind === 'interrupted') return 'interrupted'
    if (state.lastEnd?.kind === 'error' && resolved.resumeOnError) return 'error'
    return undefined
  }

  /** Every non-reason precondition; returns the first failing explanation for diagnostics. */
  function blockedBy(agent: Agent, state: ResumeState): string | undefined {
    if (state.driving) return 'driving'
    // Reconcile with the durable log before every decision: the log may hold
    // attempts from an earlier process, or records this process never observed
    // because they predate the listener.
    const durable = recoverAttempts(agent)
    if (durable.attempts > state.attempts) state.attempts = durable.attempts
    if (durable.lastAt > state.lastAt) state.lastAt = durable.lastAt
    if (state.attempts >= resolved.maxAutoResumes) return 'limit'
    if (Date.now() - state.lastAt < resolved.minIntervalMs) return 'cooldown'
    if (agent.status !== 'idle') return 'busy'
    if (agent.inbox.nextTurn.length > 0) return 'pending-input'
    const goals = ctx.get('goals') as { get?: (subject: Agent) => { activation?: string } | undefined } | undefined
    if (goals?.get?.(agent)?.activation === 'armed') return 'goal'
    const task = ctx.sessionProjections.stateOf(agent.session, 'task')
    if (task === null || task === undefined || task.status !== 'active') return 'no-active-task'
    if (resolved.requireHandoff && (task.handoff ?? '').trim().length === 0) return 'no-handoff'
    return undefined
  }

  function requestResume(agent: Agent): void {
    const state = stateFor(agent)
    const reason = resumeReason(state)
    if (reason === undefined) return
    if (blockedBy(agent, state) !== undefined) return
    const task = ctx.sessionProjections.stateOf(agent.session, 'task')
    if (task === null || task === undefined) return

    state.driving = true
    try {
      // The durable record is written before the prompt so a crash between the
      // two still counts against the attempt budget on the next start.
      agent.session.append('auto-resume/attempt', {
        reason,
        attempt: state.attempts + 1,
        taskRevision: task.revision,
        at: Date.now(),
      }, { ignorable: true })
      state.attempts += 1
      state.lastAt = Date.now()
      state.budgetStop = undefined
      state.lastEnd = undefined
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: renderResumePrompt(reason, task) }],
        source: {
          kind: 'plugin',
          plugin: 'auto-resume',
          form: 'notice',
          summary: boundContextSummary(`resumed after ${reason}`),
        },
      }))
    } finally {
      state.driving = false
    }
  }

  const observe = (session: Session, event: Parameters<Parameters<typeof ctx.on<'session/event'>>[1]>[1]): void => {
    const agent = ctx.agents.get(session.id)
    if (agent === undefined) return
    const state = stateFor(agent)
    if (event.type === 'budget/stop') {
      state.budgetStop = event.data
      return
    }
    if (event.type === 'turn/start') {
      state.budgetStop = undefined
      return
    }
    if (event.type !== 'turn/end') return
    state.lastEnd = event.data.reason
    if (event.data.reason.kind === 'aborted') {
      // A cancelled turn is a decision: never continue it, and never continue
      // anything else in this session automatically.
      state.budgetStop = undefined
      state.attempts = Number.POSITIVE_INFINITY
    }
  }

  ctx.on('session/event', observe)

  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') requestResume(agent)
  })

  /**
   * Recover the stop reason from the durable log. Repair closes an interrupted
   * tail before the agent is published, so the live `session/event` listener may
   * never see that `turn/end`; reading the log is the only reliable source.
   */
  function recoverLastEnd(agent: Agent): TurnEndReason | undefined {
    const events = agent.session.snapshotEvents()
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]
      if (event?.type === 'turn/end') return event.data.reason
    }
    return undefined
  }

  /**
   * Seed the attempt counter and cooldown from the durable log, so a restarted
   * process cannot spend a fresh budget on the same session. The highest
   * recorded attempt is authoritative; the newest record's timestamp seeds the
   * cooldown.
   * @param agent - the agent whose history is read.
   * @returns the durable counters, or zeros when the session never resumed.
   */
  function recoverAttempts(agent: Agent): { attempts: number; lastAt: number } {
    let attempts = 0
    let lastAt = 0
    for (const event of agent.session.snapshotEvents()) {
      if (event.type !== 'auto-resume/attempt') continue
      attempts = Math.max(attempts, event.data.attempt)
      lastAt = Math.max(lastAt, event.data.at)
    }
    return { attempts, lastAt }
  }

  ctx.on('agent/created', ({ agent, source }) => {
    // Seed from the log on ANY creation: a created agent may already carry a
    // resumed session's history (a fork, or a host that reattaches one), and a
    // fresh counter would let it spend the whole budget again.
    const seeded = stateFor(agent)
    seeded.attempts = Math.max(seeded.attempts, recoverAttempts(agent).attempts)
    seeded.lastAt = Math.max(seeded.lastAt, recoverAttempts(agent).lastAt)
    if (source !== 'resume') return
    const state = stateFor(agent)
    state.lastEnd = recoverLastEnd(agent)
    // agent-loop has just closed the interrupted tail; drive once it settles so
    // the resume queues behind that settlement rather than racing it.
    void agent.whenIdle().then(() => { requestResume(agent) })
  })
}
