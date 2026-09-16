/** Optional trajectory replacement; all data remains owned by the Session feed. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { NS, zh, en } from './locales.ts'
import { TokenLedger } from './TokenLedger.tsx'
import type { StepInsightInjected } from './types.ts'

/** The source feed and localization are resolved through ordinary Cordis injection. */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Replace the trajectory cell while retaining the existing target and other views.
 * @param ctx - client plugin context; disposal restores the previous slot winner.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'step-insight: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'trajectory', priority: -10, order: 10,
    label: () => t('title'), locale: NS,
    inject: (sessionId): StepInsightInjected => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`step-insight: Session ${sessionId} is unavailable`)
      return { hooks: { ledgerEvents: binding.eventSource }, loadOlder: () => binding.session.loadOlder() }
    },
  }, TokenLedger))
}
