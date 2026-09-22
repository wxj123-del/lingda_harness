/** Optional trajectory replacement; all data remains owned by the Session feed. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { NS, zh, en } from './locales.ts'
import { TokenLedger } from './TokenLedger.tsx'
import { RepositoryView } from './RepositoryView.tsx'
import type { StepInsightInjected } from './types.ts'

/** The source feed and localization are resolved through ordinary Cordis injection. */
export const inject = ['slots', 'sessions', 'locale', 'remote', 'remote.gitWorkspace']

/**
 * Replace the trajectory cell while retaining the existing target and other views.
 * @param ctx - client plugin context; disposal restores the previous slot winner.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'step-insight: dictionaries')
  const t = ctx.locale.bind(NS)
  const injectLedger = (sessionId: SessionId): StepInsightInjected => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`step-insight: Session ${sessionId} is unavailable`)
    const sessionSummary = ctx.sessions.list.getSnapshot().byId[binding.session.sessionId]
    return {
      hooks: { ledgerEvents: binding.eventSource },
      loadOlder: () => binding.session.loadOlder(),
      ...(sessionSummary?.cwd === undefined ? {} : { workspacePath: sessionSummary.cwd }),
      cloneRepository: async (request) => {
        const result = await ctx.remote.gitWorkspace.clone(request)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      listRepositoryBranches: async (url) => {
        const result = await ctx.remote.gitWorkspace.branches(url)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      inspectRepository: async (repositoryRoot) => {
        const result = await ctx.remote.gitWorkspace.inspect(repositoryRoot)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      pushRepository: async (request) => {
        const result = await ctx.remote.gitWorkspace.push(request)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    }
  }
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'trajectory', priority: -10, order: 10,
    label: () => t('title'), locale: NS,
    inject: injectLedger,
  }, TokenLedger))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'git-workspace', order: 20,
    label: () => t('repositoryView'), locale: NS,
    inject: injectLedger,
  }, RepositoryView))
}
