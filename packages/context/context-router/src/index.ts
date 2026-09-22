/** Global deterministic routing of durable session context into request snapshots. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  messageText,
  contextCapacity,
  resolveContextRoute,
  resolveContextRouteForMessages,
  resolveContextBudget,
  resolveRouterOptions,
  selectContextMessages,
  type ContextRouterOptions,
} from './router.ts'

export { contextCapacity, messageText, resolveContextBudget, resolveContextRoute, resolveContextRouteForMessages, selectContextMessages }
export type { ContextCapacity, ContextRoute, ContextScope, ContextSelection, ContextRouterOptions } from './router.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'context-router'

/** Runtime marker consumed by policy layers that must avoid a second history trim. */
export interface ContextRouterService {
  readonly active: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    contextRouter: ContextRouterService
  }
}

/** Router configuration. */
export interface Config extends Partial<ContextRouterOptions> {
  /** Disable routing while retaining the plugin registration. */
  enabled?: boolean
}

/** Schemastery configuration schema. */
export const Config: z<Config> = z.object({
  enabled: z.boolean(),
  recentMessages: z.number().step(1).min(1),
  taskMessages: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
})

interface OpenTurnStart {
  turn: number
  messageId?: string
}

/** Durable accounting for the exact message snapshot sent to the model. */
export interface ContextRouterAudit {
  turn: number
  step: number
  scope: 'fresh' | 'recent' | 'task' | 'full'
  reason: string
  inputMessages: number
  outputMessages: number
  droppedMessages: number
  estimatedInputTokens: number
  selectedMessageIds: string[]
  maxInputTokens?: number
  contextWindow?: number
  outputBudgetTokens?: number
  toolSchemaTokens?: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Audit of the request-context snapshot selected by the global router. */
    'context/router': {
      turn: number
      step: number
      scope: 'fresh' | 'recent' | 'task' | 'full'
      reason: string
      inputMessages: number
      outputMessages: number
      droppedMessages: number
      estimatedInputTokens: number
      selectedMessageIds: string[]
      maxInputTokens?: number
      contextWindow?: number
      outputBudgetTokens?: number
      toolSchemaTokens?: number
    }
  }
}

/** Install the router after other request-context listeners have transformed their output. */
export function apply(ctx: Context, config: Config = {}): void {
  const enabled = config.enabled !== false
  const options = resolveRouterOptions(config)
  ctx.provide('contextRouter', { active: enabled })
  const openTurns = new WeakMap<Session, OpenTurnStart>()
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      openTurns.set(session, { turn: event.data.turn })
    } else if (event.type === 'user/message' && event.data.source.kind === 'user') {
      const openTurn = openTurns.get(session)
      if (openTurn !== undefined && openTurn.messageId === undefined) {
        openTurns.set(session, { ...openTurn, messageId: String(event.data.id) })
      }
    } else if (event.type === 'turn/end') {
      openTurns.delete(session)
    }
  })
  ctx.on('agent/request-context', async ({ agent, turn, step }, next) => {
    const transformed = await next()
    if (!enabled) return transformed
    const query = [...transformed].toReversed().find(message => message.source.kind === 'user')
    const queryText = query === undefined ? '' : messageText(query)
    const tracked = openTurns.get(agent.session)
    if (step === 1 || tracked?.turn !== turn) {
      openTurns.set(agent.session, { turn, ...(query === undefined ? {} : { messageId: String(query.id) }) })
    }
    // `step > 1` is an open-turn continuation: the durable history after the
    // turn's first direct user message is the live tool working set, not
    // unrelated cross-turn history. Route selection only applies at the turn
    // boundary.
    const openTurn = openTurns.get(agent.session)
    const startId = step > 1 && openTurn?.turn === turn ? openTurn.messageId : undefined
    const currentTurnStart = startId === undefined
      ? -1
      : transformed.findIndex(message => String(message.id) === startId)
    const route = step > 1
      ? { scope: 'task' as const, reason: '当前 turn 工作集必须保留' }
      : resolveContextRouteForMessages(queryText, transformed, options.recentMessages)
    const capacity = contextCapacity(agent.session)
    const personalAgent = ctx.get('personalAgent') as {
      policy?: (session: Session) => { maxContextTokens?: number }
    } | undefined
    const policy = personalAgent === undefined || personalAgent.policy === undefined
      ? undefined
      : personalAgent.policy(agent.session)
    const policyMaxTokens = policy?.maxContextTokens
    const configuredMaxTokens = config.maxTokens === undefined
      ? policyMaxTokens ?? options.maxTokens
      : Math.min(options.maxTokens, policyMaxTokens ?? options.maxTokens)
    const routedOptions = { ...options, maxTokens: configuredMaxTokens }
    const maxInputTokens = resolveContextBudget(routedOptions, capacity)
    const selection = selectContextMessages(transformed, route, { ...routedOptions, maxTokens: maxInputTokens }, currentTurnStart)
    agent.session.append('context/router', {
      turn,
      step,
      scope: selection.scope,
      reason: selection.reason,
      inputMessages: transformed.length,
      outputMessages: selection.messages.length,
      droppedMessages: selection.droppedMessages,
      estimatedInputTokens: selection.estimatedInputTokens,
      selectedMessageIds: selection.messages.map(message => String(message.id)),
      maxInputTokens,
      ...capacity,
    }, { ignorable: true })
    return selection.messages
  // Wrap the other request-context listeners so this selector runs on their
  // final output. The audit must describe the snapshot that reaches the loop,
  // not an intermediate history before mode-specific bounds are applied.
  }, { global: true, prepend: true })
}
