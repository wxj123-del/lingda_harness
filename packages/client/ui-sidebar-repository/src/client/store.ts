/**
 * The source-control panel's view state: the last read of the checkout, what
 * the panel is busy doing, and the commit message draft.
 *
 * The repository itself is Host data, not a store fact — this holds only what
 * one tab keeps across remounts: the snapshot it last received, the pending
 * operation, and what the reader has typed.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { RepositoryChangeSnapshot } from '@deepseek-ai/dsh-git-workspace'

/** Which operation the panel is waiting on, so its buttons can show it. */
export type PendingAction = 'read' | 'stage' | 'unstage' | 'commit' | 'pull'

/** One tab's panel state. */
export interface RepositoryTabState {
  /** Absolute repository root, once resolved. */
  repositoryRoot?: string
  /** The most recent checkout read. */
  snapshot?: RepositoryChangeSnapshot
  /** The push in flight, if any. */
  pending?: PendingAction
  /** The commit message draft, kept across remounts. */
  message: string
  /** A settled failure the reader has not dismissed. */
  failure?: RemoteFailure
  /** A one-line success note, e.g. the commit the panel just created. */
  notice?: string
}

/** Every tab's panel state, keyed by tab id. */
export interface RepositoryState {
  byTab: Record<TabId, RepositoryTabState>
}

/**
 * One tab's bucket, which every writer after `start` relies on.
 * @param state - the draft.
 * @param tabId - the tab being written.
 * @returns the tab's state.
 */
function bucket(state: RepositoryState, tabId: TabId): RepositoryTabState {
  const entry = state.byTab[tabId]
  if (entry === undefined) throw new Error(`ui-sidebar-repository: no state for tab "${tabId}"`)
  return entry
}

/** The panel store's write set; every action names the tab it writes. */
type RepositoryActions = {
  start: (draft: RepositoryState, tabId: TabId) => void
  located: (draft: RepositoryState, tabId: TabId, repositoryRoot: string | undefined) => void
  pending: (draft: RepositoryState, tabId: TabId, action: PendingAction | undefined) => void
  loaded: (draft: RepositoryState, tabId: TabId, snapshot: RepositoryChangeSnapshot) => void
  failed: (draft: RepositoryState, tabId: TabId, failure: RemoteFailure) => void
  noted: (draft: RepositoryState, tabId: TabId, notice: string | undefined) => void
  typed: (draft: RepositoryState, tabId: TabId, message: string) => void
  cleared: (draft: RepositoryState, tabId: TabId) => void
  forget: (draft: RepositoryState, tabId: TabId) => void
}

/**
 * Declare the source-control store.
 *
 * A factory rather than a shared handle: the registration declares it as an
 * exclusive store, so the framework mints one instance per session.
 * @returns the store handle to declare on the registration.
 */
export function createRepositoryStore(): EngineStoreHandle<RepositoryState, RepositoryActions> {
  return defineStore({
    init: (): RepositoryState => ({ byTab: {} }),
    actions: {
      /**
       * Seed one tab's bucket.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      start: (d, tabId: TabId) => {
        d.byTab[tabId] = { message: '' }
      },
      /**
       * Record the repository root a session workspace resolved to.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param repositoryRoot - absolute root, or undefined for a plain workspace.
       */
      located: (d, tabId: TabId, repositoryRoot: string | undefined) => {
        const entry = bucket(d, tabId)
        if (repositoryRoot === undefined) delete entry.repositoryRoot
        else entry.repositoryRoot = repositoryRoot
      },
      /**
       * Record which operation is in flight.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param action - the operation, or undefined when idle.
       */
      pending: (d, tabId: TabId, action: PendingAction | undefined) => {
        const entry = bucket(d, tabId)
        if (action === undefined) delete entry.pending
        else entry.pending = action
      },
      /**
       * Record a settled read.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param snapshot - the checkout as the Host reported it.
       */
      loaded: (d, tabId: TabId, snapshot: RepositoryChangeSnapshot) => {
        const entry = bucket(d, tabId)
        entry.snapshot = snapshot
        delete entry.failure
      },
      /**
       * Record why an operation failed.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the settled Remote failure.
       */
      failed: (d, tabId: TabId, failure: RemoteFailure) => {
        bucket(d, tabId).failure = failure
      },
      /**
       * Record or clear the one-line success note.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param notice - the note, or undefined to clear it.
       */
      noted: (d, tabId: TabId, notice: string | undefined) => {
        const entry = bucket(d, tabId)
        if (notice === undefined) delete entry.notice
        else entry.notice = notice
      },
      /**
       * Record the commit message draft.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param message - what the composer holds.
       */
      typed: (d, tabId: TabId, message: string) => {
        bucket(d, tabId).message = message
      },
      /**
       * Clear the failure and the notice, for a fresh read.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      cleared: (d, tabId: TabId) => {
        const entry = bucket(d, tabId)
        delete entry.failure
        delete entry.notice
      },
      /**
       * Forget one tab's state, for a tab record that is gone.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      forget: (d, tabId: TabId) => {
        d.byTab = Object.fromEntries(Object.entries(d.byTab).filter(([id]) => id !== tabId))
      },
    },
  })
}
