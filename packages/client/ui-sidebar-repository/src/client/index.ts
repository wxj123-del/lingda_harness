/**
 * Browser half: register `repository` as a right-Sidebar tab type.
 *
 * The public two-stage path: the type into `ctx.sidebarRightTabs`, the body into
 * the keyed `sidebar.right.pane.tab` seat and the chip title into the keyed
 * `sidebar.right.pane.tab.title` seat, both under the type's `id`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { REPOSITORY_ID, repositoryDefinition } from './definition.tsx'
import { repositoryFace } from './face.ts'
import { RepositoryBody } from './RepositoryBody.tsx'
import { RepositoryTitle } from './RepositoryTitle.tsx'
import { createRepositoryStore } from './store.ts'
import { en, zh } from './locales.ts'

export type { SidebarRepositoryKey } from './locales.ts'
export type { ChangeGroups, ChangeKind, ChangeRow, HistoryRow } from './state-view.ts'
export type { PendingAction, RepositoryState, RepositoryTabState } from './store.ts'
export type { RepositoryInjected, RepositoryRemote } from './face.ts'
export type { RepositoryBodyProps } from './RepositoryBody.tsx'

/** This package's copy namespace. */
const NS = 'sidebarRepository'

/**
 * Required browser services: the tab registry, the keyed seat, the Remote
 * carrier and its namespace, and copy.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.gitWorkspace']

/**
 * Client plugin body: register the type, its dictionaries, its body, and its chip title.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(repositoryDefinition(t)), 'ui-sidebar-repository: repository type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-repository: dictionaries')

  const store = createRepositoryStore()
  const injected = repositoryFace(ctx.remote)
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: REPOSITORY_ID, locale: NS, store, inject: injected },
    RepositoryBody,
  )), 'ui-sidebar-repository: repository tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: REPOSITORY_ID },
    RepositoryTitle,
  )), 'ui-sidebar-repository: repository tab title')
}
