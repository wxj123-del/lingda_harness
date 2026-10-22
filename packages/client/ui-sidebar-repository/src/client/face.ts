/**
 * The panel's asynchronous half: resolving the repository and running the
 * staging, commit, and pull operations.
 *
 * The component never awaits anything. It calls these callbacks, and this face
 * performs the Remote call and writes the outcome through the store's own
 * actions — the Slot-standard `inject` shape, so the session id is resolved by
 * the framework and the write set stays the store's.
 *
 * Every operation that changes the checkout writes the snapshot the Host read
 * back after it, so the panel's rows and its counters can never disagree.
 */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RepositoryChangeSnapshot, RepositoryLocation } from '@deepseek-ai/dsh-git-workspace'
import type { createRepositoryStore, PendingAction } from './store.ts'

/** The slice of the Client Remote face this package calls. */
export type RepositoryRemote = {
  readonly gitWorkspace: Pick<ClientRemote['gitWorkspace'], 'locate' | 'state' | 'stage' | 'unstage' | 'commit' | 'pull'>
}

/** The panel's injected business face, as the body receives it. */
export interface RepositoryInjected {
  /**
   * Resolve the repository for this session's workspace and read it.
   * @param tabId - the tab being drawn.
   * @param workspacePath - the session's workspace directory, if it has one.
   * @param signal - the tab record's lifetime.
   */
  readonly start: (tabId: TabId, workspacePath: string, signal: AbortSignal) => void
  /**
   * Read the checkout again.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly reload: (tabId: TabId, signal: AbortSignal) => void
  /**
   * Stage or unstage a set of paths; one path is the single-row case.
   * @param tabId - the tab being drawn.
   * @param paths - repository-relative paths.
   * @param staged - true to stage, false to unstage.
   * @param signal - the tab record's lifetime.
   */
  readonly apply: (tabId: TabId, paths: readonly string[], staged: boolean, signal: AbortSignal) => void
  /**
   * Commit the staged changes.
   * @param tabId - the tab being drawn.
   * @param message - the commit subject the reader typed.
   * @param signal - the tab record's lifetime.
   */
  readonly commit: (tabId: TabId, message: string, signal: AbortSignal) => void
  /**
   * Fetch and fast-forward the checkout from its upstream.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly pull: (tabId: TabId, signal: AbortSignal) => void
}

/** What one root resolution settled on. */
type Located = RepositoryLocation

/**
 * Bind the panel's face to one Remote namespace.
 * @param remote - the Client Remote face carrying `gitWorkspace`.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function repositoryFace(
  remote: RepositoryRemote,
): (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createRepositoryStore>>) => RepositoryInjected {
  return (
    _sessionId: SessionId,
    actions: BoundActions<ReturnType<typeof createRepositoryStore>>,
  ): RepositoryInjected => {
    /** Per tab, the operation generation a settlement must match; the latest call wins. */
    const generations = new Map<TabId, number>()
    /** Per tab, the repository root `start` resolved; later calls reuse it. */
    const roots = new Map<TabId, string | undefined>()
    /**
     * Run one operation and write its settlement, unless a newer one started.
     * @param tabId - the tab being drawn.
     * @param signal - the tab record's lifetime.
     * @param pending - which operation this is.
     * @param call - the Remote call to perform.
     * @param onValue - what to write on success.
     */
    const run = <T>(
      tabId: TabId,
      signal: AbortSignal,
      pending: PendingAction,
      call: () => Promise<RemoteResult<T>>,
      onValue: (value: T) => void,
    ): void => {
      if (signal.aborted) return
      const generation = (generations.get(tabId) ?? 0) + 1
      generations.set(tabId, generation)
      actions.pending(tabId, pending)
      void call().then((result) => {
        if (generations.get(tabId) !== generation) return
        actions.pending(tabId, undefined)
        if (result.ok) onValue(result.value)
        else actions.failed(tabId, result.error)
      })
    }
    /** Read one checkout into the tab; a stage before a root is known is a no-op. */
    const read = (tabId: TabId, signal: AbortSignal, pending: PendingAction): void => {
      const root = roots.get(tabId)
      if (root === undefined) return
      run(tabId, signal, pending, () => remote.gitWorkspace.state(root), (snapshot: RepositoryChangeSnapshot) => {
        actions.loaded(tabId, snapshot)
      })
    }
    return {
      start(tabId, workspacePath, signal) {
        actions.start(tabId)
        signal.addEventListener('abort', () => {
          generations.delete(tabId)
          roots.delete(tabId)
          actions.forget(tabId)
        }, { once: true })
        run<Located>(tabId, signal, 'read', () => remote.gitWorkspace.locate(workspacePath), (value) => {
          actions.located(tabId, value.repositoryRoot)
          roots.set(tabId, value.repositoryRoot)
          read(tabId, signal, 'read')
        })
      },
      reload(tabId, signal) {
        read(tabId, signal, 'read')
      },
      apply(tabId, paths, staged, signal) {
        const root = roots.get(tabId)
        if (root === undefined || paths.length === 0) return
        const request = { repositoryRoot: root, paths: [...paths] }
        run(
          tabId,
          signal,
          staged ? 'stage' : 'unstage',
          () => staged ? remote.gitWorkspace.stage(request) : remote.gitWorkspace.unstage(request),
          (snapshot: RepositoryChangeSnapshot) => { actions.loaded(tabId, snapshot) },
        )
      },
      commit(tabId, message, signal) {
        const root = roots.get(tabId)
        if (root === undefined) return
        run(tabId, signal, 'commit', () => remote.gitWorkspace.commit({ repositoryRoot: root, message }), (result) => {
          actions.loaded(tabId, result)
          actions.typed(tabId, '')
          actions.noted(tabId, result.commitSha.slice(0, 7))
        })
      },
      pull(tabId, signal) {
        const root = roots.get(tabId)
        if (root === undefined) return
        run(tabId, signal, 'pull', () => remote.gitWorkspace.pull(root), (snapshot: RepositoryChangeSnapshot) => {
          actions.loaded(tabId, snapshot)
        })
      },
    }
  }
}
