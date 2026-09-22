/** Global deterministic routing of durable session context into request snapshots. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  messageText,
  resolveContextRoute,
  resolveContextRouteForMessages,
  resolveRouterOptions,
  selectContextMessages,
  type ContextRouterOptions,
} from './router.ts'

export { messageText, resolveContextRoute, resolveContextRouteForMessages, selectContextMessages }
export type { ContextRoute, ContextScope, ContextSelection, ContextRouterOptions } from './router.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'context-router'

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
    }
  }
}

/** Install the router after other request-context listeners have transformed their output. */
export function apply(ctx: Context, config: Config = {}): void {
  const enabled = config.enabled !== false
  const options = resolveRouterOptions(config)
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
    const selection = selectContextMessages(transformed, route, options, currentTurnStart)
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
    }, { ignorable: true })
    return selection.messages
  }, { global: true })
}
