/** Release/source update row for the General settings page. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RepositoryUpdateResult, RepositoryUpdateStatus } from '@deepseek-ai/dsh-api-remotes/client'
import css from './UpdateRow.module.css'

type UpdatePhase = 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'

interface UpdateState {
  readonly phase: UpdatePhase
  readonly version?: string
  readonly message?: string
}

interface DesktopUpdatesApi {
  check: () => Promise<UpdateState>
  install: () => Promise<void>
  subscribe: (listener: (state: UpdateState) => void) => () => void
}

interface DesktopApplicationBridge {
  readonly updates?: DesktopUpdatesApi
}

interface RemoteResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly message: string }
}

interface RepositoryUpdater {
  check: () => Promise<RemoteResult<RepositoryUpdateStatus>>
  update: () => Promise<RemoteResult<RepositoryUpdateResult>>
}

/** Host repository updater injected by the API Remotes assembly. */
export interface UpdateRowInjected {
  repository: RepositoryUpdater
}

function desktopUpdates(): DesktopUpdatesApi | undefined {
  const bridge = (globalThis as { dshDesktop?: DesktopApplicationBridge }).dshDesktop
  return bridge?.updates
}

const SOURCE_REPOSITORY = 'XJ-Cyber/lingda-harness'
const SOURCE_BRANCH = 'main'

interface AtomGitCommitResponse {
  readonly sha?: unknown
}

function currentBuildCommit(): string | undefined {
  const value = process.env.DSH_CLIENT_COMMIT_HASH
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/iu.test(value) ? value.toLowerCase() : undefined
}

/** Check the canonical AtomGit source when no local Host updater is available. */
async function checkSourceUpdate(): Promise<UpdateState> {
  const response = await fetch(
    `https://api.atomgit.com/api/v5/repos/${SOURCE_REPOSITORY}/commits/${SOURCE_BRANCH}`,
    { headers: { Accept: 'application/json' } },
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json() as AtomGitCommitResponse
  if (typeof payload.sha !== 'string' || !/^[0-9a-f]{7,40}$/iu.test(payload.sha)) {
    throw new Error('AtomGit 仓库返回了无效的提交信息')
  }
  const current = currentBuildCommit()
  if (current === undefined) return { phase: 'error', message: '当前构建缺少提交信息，无法比较源码版本' }
  if (current !== undefined && payload.sha.toLowerCase().startsWith(current)) {
    return { phase: 'idle' }
  }
  return { phase: 'available', version: payload.sha.slice(0, 7) }
}

export type UpdateRowProps = PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & Partial<InjectFace<UpdateRowInjected>>

/** Render the native updater or source-stream checker in the General section. */
export function UpdateRow({ t, repository }: UpdateRowProps) {
  const api = desktopUpdates()
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })
  const [sourceState, setSourceState] = useState<UpdateState>({ phase: 'idle' })
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (api === undefined) return
    return api.subscribe(setState)
  }, [api])

  useEffect(() => {
    if (api !== undefined || repository === undefined) return
    let disposed = false
    const check = async (): Promise<void> => {
      setSourceState(current => current.phase === 'installing' ? current : { phase: 'checking' })
      try {
        const result = await repository.check()
        if (disposed) return
        if (!result.ok) throw new Error(result.error?.message ?? t('update.error'))
        if (result.value === undefined) throw new Error(t('update.error'))
        setSourceState(result.value.state === 'available'
          ? { phase: 'available', version: result.value.remoteHead.slice(0, 7) }
          : result.value.state === 'blocked' || result.value.state === 'diverged' || result.value.state === 'local-ahead'
            ? { phase: 'error', message: result.value.reason ?? t('update.error') }
            : { phase: 'idle' })
      } catch (error) {
        if (!disposed) setSourceState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    }
    void check()
    const timer = globalThis.setInterval(() => { void check() }, 5 * 60 * 1_000)
    return () => {
      disposed = true
      globalThis.clearInterval(timer)
    }
  }, [api, repository, t])

  if (api === undefined && repository === undefined) {
    const busy = running || sourceState.phase === 'checking'
    const status = sourceState.phase === 'available'
      ? `${t('update.available')} · ${sourceState.version ?? ''}`
      : sourceState.phase === 'error'
        ? sourceState.message ?? t('update.error')
        : sourceState.phase === 'checking'
          ? t('update.checking')
          : sourceState.phase === 'idle'
            ? t('update.source')
            : t('update.current')

    const run = async (): Promise<void> => {
      setRunning(true)
      setSourceState({ phase: 'checking' })
      try {
        setSourceState(await checkSourceUpdate())
      } catch (error) {
        setSourceState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      } finally {
        setRunning(false)
      }
    }

    return (
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('update.title')}</div>
          <div className={css.desc} role={sourceState.phase === 'error' ? 'alert' : undefined}>{status}</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          aria-busy={busy}
          onClick={() => { void run() }}
        >
          {t('update.check')}
        </Button>
      </div>
    )
  }

  if (api === undefined && repository !== undefined) {
    const busy = running || sourceState.phase === 'checking' || sourceState.phase === 'installing'
    const available = sourceState.phase === 'available'
    const status = sourceState.phase === 'available'
      ? `${t('update.available')} · ${sourceState.version ?? ''}`
      : sourceState.phase === 'error'
        ? sourceState.message ?? t('update.error')
        : sourceState.phase === 'checking'
          ? t('update.checking')
          : sourceState.phase === 'installing'
            ? t('update.installing')
            : sourceState.phase === 'ready'
              ? sourceState.message ?? t('update.ready')
              : t('update.current')

    const run = async (): Promise<void> => {
      setRunning(true)
      try {
        if (available) {
          setSourceState({ phase: 'installing' })
          const result = await repository.update()
          if (!result.ok) throw new Error(result.error?.message ?? t('update.error'))
          setSourceState({ phase: 'ready', ...(result.value?.restartScheduled === false ? { message: t('update.sourceReady') } : {}) })
          return
        }
        setSourceState({ phase: 'checking' })
        const result = await repository.check()
        if (!result.ok) throw new Error(result.error?.message ?? t('update.error'))
        if (result.value === undefined) throw new Error(t('update.error'))
        setSourceState(result.value.state === 'available'
          ? { phase: 'available', version: result.value.remoteHead.slice(0, 7) }
          : result.value.state === 'blocked' || result.value.state === 'diverged' || result.value.state === 'local-ahead'
            ? { phase: 'error', message: result.value.reason ?? t('update.error') }
            : { phase: 'idle' })
      } catch (error) {
        setSourceState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      } finally {
        setRunning(false)
      }
    }

    return (
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('update.title')}</div>
          <div className={css.desc} role={sourceState.phase === 'error' ? 'alert' : undefined}>{status}</div>
        </div>
        <Button
          variant={available ? 'primary' : 'outline'}
          size="sm"
          disabled={busy}
          aria-busy={busy}
          onClick={() => { void run() }}
        >
          {available ? t('update.install') : t('update.check')}
        </Button>
      </div>
    )
  }

  const desktopApi = api
  if (desktopApi === undefined) return null
  const available = state.phase === 'available'
  const busy = running || state.phase === 'checking' || state.phase === 'installing' || state.phase === 'ready'
  const status = state.phase === 'available'
    ? `${t('update.available')} · ${state.version ?? ''}`
    : state.phase === 'error'
      ? state.message ?? t('update.error')
      : state.phase === 'checking'
        ? t('update.checking')
        : state.phase === 'installing'
          ? t('update.installing')
          : state.phase === 'ready'
            ? sourceState.message ?? t('update.ready')
            : t('update.current')

  const run = async (): Promise<void> => {
    setRunning(true)
    try {
      if (available) await desktopApi.install()
      else setState(await desktopApi.check())
    } catch (error) {
      setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('update.title')}</div>
        <div className={css.desc} role={state.phase === 'error' ? 'alert' : undefined}>{status}</div>
      </div>
      <Button
        variant={available ? 'primary' : 'outline'}
        size="sm"
        disabled={busy}
        aria-busy={busy}
        onClick={() => { void run() }}
      >
        {available ? t('update.install') : t('update.check')}
      </Button>
    </div>
  )
}
