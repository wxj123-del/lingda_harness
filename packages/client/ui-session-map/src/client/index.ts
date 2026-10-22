/**
 * Session map UI plugin, browser half: registers one Conversation View tab
 * that renders the viewed Session's turns as a spine with its forks.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row and the ui-workspace
// navigation service this View drives.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { SessionMapView, type SessionMapViewInjected } from './SessionMapView.tsx'
import { en, zh } from './locales.ts'

export type { SessionMapViewInjected, SessionMapViewProps } from './SessionMapView.tsx'
export type { SessionMapKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'sessionMap'

/** View tab id; also the fork action's navigation target. */
const VIEW_ID = 'map'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Register the map View once the Conversation declares its view list.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-session-map: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: VIEW_ID,
    order: 15,
    locale: NS,
    label: () => t('view.map'),
    inject: (sessionId: SessionId): SessionMapViewInjected => {
      // Forking is a Session verb: the list service owns the cut and the
      // child's creation. The child stays closed — the operator decides when
      // to follow a branch, and the map shows it on the spine meanwhile.
      return {
        forkAt: async (seq) => {
          await ctx.sessions.fork({ sessionId, atSeq: seq, increaseTitle: true })
        },
        openSession: (id) => { ctx.sessions.open(id) },
      }
    },
  }, SessionMapView))
}
