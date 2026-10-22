/**
 * Runtime budgets for one agent session: per-turn step, token, and wall-clock
 * ceilings plus a whole-session turn cap. The guard stops a turn at a step
 * boundary with a durable `budget/stop` record instead of letting a runaway loop
 * spend without bound, and a soft threshold asks the model to leave a handoff
 * first.
 * @module @deepseek-ai/dsh-budget-guard
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
/** Plugin name. */
export declare const name = 'budget-guard'
/** Services the guard reads: prompt sections and the agent registry for usage attribution. */
export declare const inject: string[]
/** Deployment budget policy. Every limit is optional; an omitted limit is unbounded. */
export interface Config {
  /** Maximum model steps in one turn (one step per model request). */
  maxStepsPerTurn?: number
  /** Maximum total turns in the session. */
  maxTurns?: number
  /** Maximum provider-reported input+output tokens in one turn. */
  maxTokensPerTurn?: number
  /** Maximum wall-clock milliseconds from the turn's first step to its last. */
  maxWallClockMsPerTurn?: number
  /**
     * Fraction of any limit at which one advisory handoff reminder is injected.
     * Set to 1 to disable the reminder.
     */
  warnAtRatio?: number
}
/** Schemastery configuration schema. */
export declare const Config: z<Config>
/** Why one turn stopped on a budget rather than because the model finished. */
export type BudgetReason = 'steps' | 'tokens' | 'wall-clock'
/** Durable record of one budget stop. */
export interface BudgetStop {
  turn: number
  reason: BudgetReason
  /** The limit that was exceeded. */
  limit: number
  /** The observed value at the stop. */
  observed: number
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One turn stopped at a step boundary because a runtime budget was exhausted. */
    'budget/stop': BudgetStop
  }
}
/**
 * Install the budget guard.
 * @param ctx - plugin context; listeners and the prompt section are disposed with it.
 * @param config - validated deployment budget policy.
 */
export declare function apply(ctx: Context, config: Config): void
//# sourceMappingURL=index.d.ts.map
