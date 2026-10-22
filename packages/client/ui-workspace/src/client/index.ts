/**
 * Workspace plugin, browser half. Two registrations: WorkspaceBrowser fills
 * the sidebar shell's `sidebar.workspaces` hole (the whole browsing region),
 * and WorkspacePicker fills the conversation hero's picker hole
 * (`conversation.hero.workspace` — both hero forms). Both read real Host
 * Workspaces through the global useWorkspaces hook, and each declares its
 * own `single` directory-flow child hole for the composed picker package's
 * client half (see the contract module doc). Export discipline:
 * packages/client/AGENTS.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the Controller service merges.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the Session root standard-hook merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {
  WorkspaceBrowserInjected, WorkspaceFlowPageInjected, WorkspacePickerInjected,
} from './contract/slots.ts'
import { UiWorkspaceService } from './navigation.ts'
import { createWorkspaceViewStore } from './stores.ts'
import { WorkspaceBrowser } from './rows/WorkspaceBrowser.tsx'
import { FlowPanelIcon, WorkspaceFlowPage } from './rows/WorkspaceFlowPage.tsx'
import { WorkspacePicker } from './WorkspacePicker.tsx'
import { en, zh, type WorkspaceKey } from './locales.ts'

export type { UiWorkspace } from './navigation.ts'
export type {
  DirectoryFlowOwnerProps, DirectoryFlowSlotName, DirectoryPickingHooks, DirectoryPickingInjected,
  WorkspaceBrowserInjected, WorkspaceBrowserProps, WorkspaceFlowPageInjected, WorkspaceFlowPageProps,
  WorkspacePickerInjected, WorkspacePickerProps,
} from './contract/slots.ts'
export type { WorkspaceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface GlobalStandardProps {
    /** Selector hook over the pure Workspace Controller snapshot. */
    useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>
  }

  interface LocaleNamespaceMap {
    /** The workspace browsing region and pick/create flow copy. */
    workspace: WorkspaceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'workspace'

/** Main-panel key of the flow page (also its sidebar panel-row id). */
const FLOW_PANEL_ID = 'workspace-flow' as MainPanelId

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * the ui-sidebar / ui-conversation applies, whose activation order relative
 * to this one is NOT constrained: dsh.client.inject edges are informational
 * (loading/prefetch metadata, never apply sequencing) and neither owner
 * provides a waitable service. apply therefore depends on each slot
 * declaration through `slots.inject()` instead of assuming order.
 */
export const inject = [
  'slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker', 'layout',
]

/**
 * Register the browser and picker once their slot declarations are on the
 * ledger. Inject factories return plain callbacks; data reads use the
 * framework's global hooks.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const uiWorkspace = new UiWorkspaceService(
    ctx, ctx.remote.directoryPicker, workspaces, sessions)
  ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace: dictionaries')

  const searchSessions: WorkspaceBrowserInjected['searchSessions'] = async (query, signal) => {
    const result = await sessions.search(query, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  // Stable per-surface occupancy sources (the renderer's hook cache keys by
  // source identity): true while the surface's directory-flow hole is filled.
  const flowSource = (hole: 'sidebar.workspaces.directoryFlow' | 'conversation.hero.workspace.directoryFlow'): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const browserFlowSource = flowSource('sidebar.workspaces.directoryFlow')
  const hostInfo: HostObservable<RemoteHostFacts> = {
    getSnapshot: () => ctx.remote.$host,
    subscribe: listener => ctx.on('connection/reset', listener),
  }
  const pickerFlowSource = flowSource('conversation.hero.workspace.directoryFlow')
  // One viewing-store handle shared by the browser (writes the flow target)
  // and the page (reads it): a page mounted in the main column must see the
  // same instance the folder menu wrote to.
  const viewStore = createWorkspaceViewStore()
  const openSession: WorkspaceBrowserInjected['open'] = (sessionId) => {
    uiWorkspace.openSession(sessionId)
  }
  // Selection only: the browser writes the target into the shared store first
  // (through its PropsStore actions), so navigation never invents a second
  // store instance the page would not read.
  const openFlow: WorkspaceBrowserInjected['openFlow'] = () => {
    ctx.layout.selectPanel(FLOW_PANEL_ID)
  }
  const browserInjected = (): WorkspaceBrowserInjected => ({
    // Explicit group actions keep their target; unscoped New Session inherits
    // the current Session Workspace before the recent-Workspace fallback.
    startSession: (workspaceId) => { uiWorkspace.startSession(workspaceId) },
    open: openSession,
    openFlow,
    searchSessions,
    searchResultLimit: sessions.searchResultLimit,
    renameSession: async (sessionId, title) => {
      // Row → session-face hop: rename is a per-session verb (ISession), not
      // a list-service verb; the binding resolves any listed session.
      const session = sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    forkSession: (sessionId) => {
      uiWorkspace.forkSession(sessionId)
        .catch(() => {
          // Fork or child-rename failure keeps the current selection.
        })
    },
    renameWorkspace: async (workspaceId, title) => { await workspaces.rename(workspaceId, title) },
    deleteWorkspace: async (workspaceId) => { await workspaces.delete(workspaceId) },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      await workspaces.insertBefore(workspaceId, beforeWorkspaceId)
    },
    archiveSession: async (sessionId) => { await uiWorkspace.archiveSession(sessionId) },
    createWorkspace: input => workspaces.create(input),
    hooks: { directoryFlow: browserFlowSource, hostInfo },
  })
  const pickerInjected = (): WorkspacePickerInjected => ({
    createWorkspace: input => workspaces.create(input),
    hooks: { directoryFlow: pickerFlowSource },
  })
  const flowInjected = (): WorkspaceFlowPageInjected => ({
    open: openSession,
    close: () => { ctx.layout.selectPanel(null) },
  })
  // Each registration declares its directory-flow child in the same call;
  // slot injection follows both the owner and declaration HMR lifetimes.
  // Browser and page share one store handle: the renderer keeps one root
  // instance per handle, so both read and write the same viewing state.
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces',
      children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
      store: viewStore,
      inject: browserInjected,
      locale: NS,
    },
    WorkspaceBrowser,
  ))
  // The flow page occupies the layout's keyed main slot and, once that key is
  // registered, adds its sidebar panel row so the page is reachable again
  // after navigating away.
  ctx.slots.inject('main', () => ctx.slots.register(
    {
      name: 'main',
      key: FLOW_PANEL_ID,
      store: viewStore,
      inject: flowInjected,
      locale: NS,
    },
    WorkspaceFlowPage,
  ))
  // The Flow page's entry rides the sidebar's product navigation row, which is
  // visible in every sidebar state; the page itself stays a main-panel key.
  ctx.slots.inject('sidebar.navigation.panels', () => ctx.slots.register(
    {
      name: 'sidebar.navigation.panels',
      id: FLOW_PANEL_ID,
      order: 30,
      label: () => ctx.locale.bind(NS)('flow.page.label'),
      locale: NS,
    },
    FlowPanelIcon,
  ))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register(
    {
      name: 'conversation.hero.workspace',
      children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
      inject: pickerInjected,
      locale: NS,
    },
    WorkspacePicker,
  ))
}
