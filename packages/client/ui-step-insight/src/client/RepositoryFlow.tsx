import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Button, IconAlarmClockOutline16, IconCloseOutline16, IconCodeOutline16,
  IconFolderOpenOutline16, IconRefreshOutline16, IconSearchOutline16, Input, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitCheckpointAudit } from './types.ts'
import type { RepositoryBranchesResult, RepositoryChangeSnapshot, RepositoryCloneRequest, RepositoryCloneResult, RepositoryPushRequest, RepositoryPushResult } from '@deepseek-ai/dsh-git-workspace'
import type { Translate } from './locales.ts'
import { gitSyncState, latestGitCheckpoint, parseGitDiffStat, parseGitStatus, shortSha } from './git-view.ts'
import { fetchRepositorySnapshot, normalizeRepositoryAddress, parseHostedRepositoryAddress, type RepositorySnapshot } from './repository-monitor.ts'
import css from './ledger.module.css'

interface RepositoryFlowProps {
  checkpoints: readonly GitCheckpointAudit[]
  t: Translate
  workspacePath?: string
  cloneRepository?: (request: RepositoryCloneRequest) => Promise<RepositoryCloneResult>
  listRepositoryBranches?: (url: string) => Promise<RepositoryBranchesResult>
  inspectRepository?: (repositoryRoot: string) => Promise<RepositoryChangeSnapshot>
  pushRepository?: (request: RepositoryPushRequest) => Promise<RepositoryPushResult>
}

interface TrackedRepository {
  address: string
  enabled: boolean
}

const TRACKED_REPOSITORIES_KEY = 'dsh.repository.monitor.v2'
const REPOSITORY_VIEW_MODE_KEY = 'dsh.repository.view-mode.v1'

type FlowStageId = 'source' | 'scan' | 'changes' | 'notify'
interface FlowStage { id: FlowStageId; label: string; detail: string }

function readViewMode(): 'flow' | 'tree' {
  if (typeof localStorage === 'undefined') return 'tree'
  return localStorage.getItem(REPOSITORY_VIEW_MODE_KEY) === 'flow' ? 'flow' : 'tree'
}

function TreeNode({ stage, state, children }: { stage: FlowStage; state: 'done' | 'warning' | 'ongoing' | 'idle' | 'error'; children?: ReactNode }) {
  return <div className={css.treeNode} data-state={state}>
    <span className={css.treeNodeIcon}><StageIcon stage={stage.id} /></span>
    <span className={css.treeNodeText}><b>{stage.label}</b><small title={stage.detail}>{stage.detail}</small></span>
    {children}
  </div>
}

function normalizeScopePath(path: string | undefined): string | undefined {
  const value = path?.trim() ?? ''
  if (value === '') return undefined
  const absolute = value.startsWith('/')
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts.at(-1) !== '..') parts.pop()
      else if (!absolute) parts.push(part)
      continue
    }
    parts.push(part)
  }
  const normalized = parts.join('/')
  return absolute ? `/${normalized}` : normalized
}

function repositoryStorageKey(workspacePath?: string): string {
  const scope = normalizeScopePath(workspacePath) || 'unscoped'
  return `${TRACKED_REPOSITORIES_KEY}:${scope}`
}

function readTrackedRepositories(workspacePath?: string): TrackedRepository[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(repositoryStorageKey(workspacePath))
    if (raw === null) return []
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return []
      const record = item as { address?: unknown; enabled?: unknown }
      return typeof record.address === 'string' && record.address.trim() !== ''
        ? [{ address: record.address, enabled: record.enabled !== false }]
        : []
    })
  } catch {
    return []
  }
}

function persistTrackedRepositories(workspacePath: string | undefined, repositories: readonly TrackedRepository[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(repositoryStorageKey(workspacePath), JSON.stringify(repositories))
}

function displayAddress(address: string): string {
  if (address.length <= 64) return address
  return `${address.slice(0, 28)}...${address.slice(-32)}`
}

function isCloneAddress(address: string): boolean {
  return /^(?:https:\/\/|ssh:\/\/|git@)[^\s]+$/iu.test(address.trim())
}

function isPathWithinScope(path: string, scope?: string): boolean {
  const normalizedPath = normalizeScopePath(path)
  const normalizedScope = normalizeScopePath(scope)
  if (normalizedPath === undefined || normalizedScope === undefined) return normalizedScope === undefined
  if (normalizedScope === '/') return normalizedPath.startsWith('/')
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`)
}

function shortCommit(sha: string, author: string, date: string | null): string {
  const timestamp = date === null ? '' : ` · ${new Date(date).toLocaleString()}`
  return `${shortSha(sha)} · ${author || '—'}${timestamp}`
}

function repositoryStatus(
  repository: TrackedRepository,
  currentPath: string | undefined,
  currentRemote: string | undefined,
  hasCheckpoint: boolean,
  hasRemoteSnapshot: boolean,
  hasError: boolean,
): { key: 'gitWatching' | 'gitWaiting' | 'gitError'; tone: 'success' | 'quiet' | 'danger' } {
  if (hasError) return { key: 'gitError', tone: 'danger' }
  const matchesLocalPath = repository.address === currentPath
  const matchesLocalRemote = currentRemote !== undefined
    && normalizeRepositoryAddress(repository.address) === normalizeRepositoryAddress(currentRemote)
  if (repository.enabled && ((matchesLocalPath || matchesLocalRemote) && hasCheckpoint || hasRemoteSnapshot)) return { key: 'gitWatching', tone: 'success' }
  return { key: 'gitWaiting', tone: 'quiet' }
}

function checkpointMatchesAddress(checkpoint: GitCheckpointAudit | undefined, address: string): boolean {
  if (checkpoint === undefined) return false
  if (address === checkpoint.repositoryRoot || address === checkpoint.cwd) return true
  return checkpoint.remote !== undefined
    && normalizeRepositoryAddress(address) === normalizeRepositoryAddress(checkpoint.remote)
}

function stageState(
  stage: 'source' | 'scan' | 'changes' | 'notify',
  latest: GitCheckpointAudit | undefined,
  observed: boolean,
  snapshot: RepositorySnapshot | undefined,
): 'done' | 'warning' | 'ongoing' | 'idle' | 'error' {
  if (snapshot?.error !== undefined) return 'error'
  if (stage === 'source') return latest === undefined && snapshot === undefined ? 'idle' : 'done'
  if (latest?.error !== undefined) return 'error'
  if (stage === 'scan') return latest === undefined && snapshot === undefined ? 'idle' : 'done'
  if (stage === 'changes') {
    if (latest === undefined) return 'idle'
    return parseGitStatus(latest.status).length > 0
      || parseGitDiffStat(latest.diffStat).files !== null
      || latest.syncState === 'remote-ahead'
      || latest.syncState === 'local-ahead'
      || latest.syncState === 'diverged'
      || latest.syncState === 'different' ? 'warning' : 'done'
  }
  return observed ? 'ongoing' : 'idle'
}

function repositorySyncLabel(state: RepositoryChangeSnapshot['syncState'], t: Translate): string {
  return state === 'synced' ? t('gitSyncSynced')
    : state === 'remote-ahead' ? t('gitSyncRemoteAhead')
      : state === 'local-ahead' ? t('gitSyncLocalAhead')
        : state === 'diverged' ? t('gitSyncDiverged')
          : state === 'different' ? t('gitSyncDifferent') : t('gitSyncUnknown')
}

function StageIcon({ stage }: { stage: 'source' | 'scan' | 'changes' | 'notify' }) {
  if (stage === 'source') return <IconFolderOpenOutline16 />
  if (stage === 'scan') return <IconSearchOutline16 />
  if (stage === 'changes') return <IconCodeOutline16 />
  return <IconAlarmClockOutline16 />
}

/** Manage repository targets and render the Git flow. */
export function RepositoryFlow({
  checkpoints,
  t,
  workspacePath,
  cloneRepository,
  listRepositoryBranches,
  inspectRepository,
  pushRepository,
}: RepositoryFlowProps) {
  const latestCheckpoint = useMemo(() => latestGitCheckpoint(checkpoints), [checkpoints])
  const repositoryScope = normalizeScopePath(workspacePath ?? latestCheckpoint?.cwd ?? latestCheckpoint?.repositoryRoot)
  const checkpointPath = latestCheckpoint?.repositoryRoot ?? latestCheckpoint?.cwd
  const latest = latestCheckpoint !== undefined
    && (repositoryScope === undefined || checkpointPath === undefined || isPathWithinScope(checkpointPath, repositoryScope))
    ? latestCheckpoint
    : undefined
  const [draft, setDraft] = useState('')
  const [targetDirectory, setTargetDirectory] = useState(workspacePath ?? '')
  const [cloneBusy, setCloneBusy] = useState(false)
  const [cloneError, setCloneError] = useState<string | null>(null)
  const [cloneResult, setCloneResult] = useState<RepositoryCloneResult | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [branchesError, setBranchesError] = useState<string | null>(null)
  const [tracked, setTracked] = useState<TrackedRepository[]>(() => readTrackedRepositories(repositoryScope))
  const [trackedScope, setTrackedScope] = useState(repositoryScope)
  const [snapshots, setSnapshots] = useState<Record<string, RepositorySnapshot>>({})
  const [liveChanges, setLiveChanges] = useState<RepositoryChangeSnapshot | null>(null)
  const [inspectBusy, setInspectBusy] = useState(false)
  const [inspectError, setInspectError] = useState<string | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pushResult, setPushResult] = useState<RepositoryPushResult | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [refreshToken, setRefreshToken] = useState(0)
  const [viewMode, setViewMode] = useState<'flow' | 'tree'>(readViewMode)
  const [addressError, setAddressError] = useState<string | null>(null)
  const currentPath = latest?.repositoryRoot ?? latest?.cwd
  const currentRemote = latest?.remote
  const hasCheckpoint = latest !== undefined
  const primaryAddress = tracked.find(item => item.enabled)?.address ?? currentPath
  const primaryLocalAddress = tracked.find(item => item.enabled && !isCloneAddress(item.address))?.address
  const primaryTracked = tracked.find(item => item.enabled)
  const checkpointMatchesPrimary = primaryTracked === undefined || checkpointMatchesAddress(latest, primaryTracked.address)
  const scopedCheckpointRoot = latest?.repositoryRoot !== undefined && isPathWithinScope(latest.repositoryRoot, repositoryScope)
    ? latest.repositoryRoot
    : undefined
  const scopedCheckpointCwd = latest?.cwd !== undefined && isPathWithinScope(latest.cwd, repositoryScope)
    ? latest.cwd
    : undefined
  const repositoryPath = cloneResult?.repositoryRoot
    ?? scopedCheckpointRoot
    ?? (primaryLocalAddress !== undefined && isPathWithinScope(primaryLocalAddress, repositoryScope) ? primaryLocalAddress : undefined)
    ?? (checkpointMatchesPrimary ? scopedCheckpointCwd ?? workspacePath : undefined)
  const primarySnapshot = primaryAddress === undefined ? undefined : snapshots[primaryAddress]
  const observed = tracked.some(item => item.enabled && checkpointMatchesAddress(latest, item.address))
    || tracked.some(item => item.enabled && (snapshots[item.address]?.commits.length ?? 0) > 0)
  const activeCount = tracked.filter(item => item.enabled).length
  const sync = gitSyncState(latest)
  const syncLabel = sync.label === 'synced' ? t('gitSyncSynced')
    : sync.label === 'remote-ahead' ? t('gitSyncRemoteAhead')
      : sync.label === 'local-ahead' ? t('gitSyncLocalAhead')
        : sync.label === 'diverged' ? t('gitSyncDiverged')
          : sync.label === 'different' ? t('gitSyncDifferent') : t('gitSyncUnknown')

  useEffect(() => {
    if (trackedScope !== repositoryScope) return
    persistTrackedRepositories(repositoryScope, tracked)
  }, [repositoryScope, tracked, trackedScope])

  useEffect(() => {
    if (trackedScope === repositoryScope) return
    setTrackedScope(repositoryScope)
    setTracked(readTrackedRepositories(repositoryScope))
    setTargetDirectory(workspacePath ?? '')
    setDraft('')
    setAddressError(null)
    setSnapshots({})
    setCloneResult(null)
    setCloneError(null)
    setLiveChanges(null)
    setInspectError(null)
    setPushResult(null)
    setPushError(null)
    setCommitMessage('')
  }, [repositoryScope, trackedScope, workspacePath])

  useEffect(() => {
    if (targetDirectory === '' && workspacePath !== undefined) setTargetDirectory(workspacePath)
  }, [targetDirectory, workspacePath])

  useEffect(() => {
    const url = draft.trim()
    if (listRepositoryBranches === undefined || !isCloneAddress(url)) {
      setBranches([])
      setBranch('')
      setBranchesError(null)
      return
    }
    let cancelled = false
    setBranchesError(null)
    const timer = window.setTimeout(() => {
      void listRepositoryBranches(url).then((result) => {
        if (cancelled) return
        setBranches(result.branches)
        setBranch(current => current !== '' && result.branches.includes(current) ? current : (result.branches.includes('main') ? 'main' : result.branches[0] ?? ''))
      }).catch((error) => {
        if (cancelled) return
        setBranches([])
        setBranch('')
        setBranchesError(error instanceof Error ? error.message : String(error))
      })
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [draft, listRepositoryBranches])

  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(REPOSITORY_VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  useEffect(() => {
    const active = tracked.filter(item => item.enabled && parseHostedRepositoryAddress(item.address) !== null)
    if (active.length === 0) return
    let cancelled = false
    const controller = new AbortController()
    const refresh = async (): Promise<void> => {
      const results = await Promise.all(active.map(async (item) => {
        try {
          return await fetchRepositorySnapshot(item.address, controller.signal)
        } catch (error) {
          if (controller.signal.aborted) return null
          return { address: item.address, name: item.address, branch: '', commits: [], fetchedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }
        }
      }))
      if (cancelled) return
      setSnapshots((previous) => {
        const next = { ...previous }
        for (const snapshot of results) if (snapshot !== null) next[snapshot.address] = snapshot
        return next
      })
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [refreshToken, tracked])

  useEffect(() => {
    if (inspectRepository === undefined || repositoryPath === undefined || repositoryPath.trim() === '') {
      setLiveChanges(null)
      setInspectError(null)
      setInspectBusy(false)
      return
    }
    let cancelled = false
    const refresh = async (): Promise<void> => {
      setInspectBusy(true)
      setInspectError(null)
      try {
        const result = await inspectRepository(repositoryPath)
        if (!cancelled) setLiveChanges(result)
      } catch (error) {
        if (!cancelled) {
          setLiveChanges(null)
          setInspectError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) setInspectBusy(false)
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [inspectRepository, repositoryPath, refreshToken])

  const addRepository = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const address = draft.trim()
    if (address === '') return
    setAddressError(null)
    if (!isCloneAddress(address) && !isPathWithinScope(address, repositoryScope)) {
      setAddressError(t('gitRepositoryOutsideWorkspace'))
      return
    }
    if (cloneRepository !== undefined && targetDirectory.trim() !== '' && isCloneAddress(address)) {
      void cloneRepositoryIntoFolder()
      return
    }
    setTracked(previous => previous.some(item => item.address === address)
      ? previous.map(item => item.address === address ? { ...item, enabled: true } : item)
      : [...previous, { address, enabled: true }])
    setDraft('')
  }

  async function cloneRepositoryIntoFolder(): Promise<void> {
    const url = draft.trim()
    const target = targetDirectory.trim()
    if (cloneRepository === undefined || url === '' || target === '' || cloneBusy) return
    setAddressError(null)
    if (!isPathWithinScope(target, repositoryScope)) {
      setCloneError(t('gitRepositoryOutsideWorkspace'))
      return
    }
    setCloneBusy(true)
    setCloneError(null)
    setCloneResult(null)
    try {
      const result = await cloneRepository({ url, targetDirectory: target, ...(branch === '' ? {} : { branch }) })
      if (!isPathWithinScope(result.repositoryRoot, repositoryScope)) {
        setCloneError(t('gitRepositoryOutsideWorkspace'))
        return
      }
      setCloneResult(result)
      setTracked(previous => previous.some(item => item.address === url)
        ? previous.map(item => item.address === url ? { ...item, enabled: true } : item)
        : [...previous, { address: url, enabled: true }])
      setRefreshToken(value => value + 1)
    } catch (error) {
      setCloneError(error instanceof Error ? error.message : String(error))
    } finally {
      setCloneBusy(false)
    }
  }

  const toggleRepository = (address: string, enabled: boolean): void => {
    setTracked(previous => previous.map(item => item.address === address ? { ...item, enabled } : item))
  }

  const removeRepository = (address: string): void => {
    setTracked(previous => previous.filter(item => item.address !== address))
  }

  async function publishRepository(): Promise<void> {
    if (pushRepository === undefined || repositoryPath === undefined || pushBusy) return
    const dirty = liveChanges?.status.trim() !== ''
    if (dirty && commitMessage.trim() === '') return
    setPushBusy(true)
    setPushError(null)
    setPushResult(null)
    try {
      const result = await pushRepository({
        repositoryRoot: repositoryPath,
        ...(commitMessage.trim() === '' ? {} : { message: commitMessage.trim() }),
        includeUntracked,
      })
      setPushResult(result)
      setLiveChanges(result)
      setCommitMessage('')
      setRefreshToken(value => value + 1)
    } catch (error) {
      setPushError(error instanceof Error ? error.message : String(error))
    } finally {
      setPushBusy(false)
    }
  }

  const liveFiles = liveChanges === null ? [] : parseGitStatus(liveChanges.status)
  const liveStat = liveChanges === null ? { files: null, insertions: null, deletions: null } : parseGitDiffStat(liveChanges.diffStat)
  const liveDirty = liveChanges?.status.trim() !== ''
  const liveSyncLabel = liveChanges === null ? t('gitSyncUnknown') : repositorySyncLabel(liveChanges.syncState, t)
  const canPublish = pushRepository !== undefined && repositoryPath !== undefined && liveChanges !== null
    && liveChanges.remote !== undefined && !pushBusy && (!liveDirty || commitMessage.trim() !== '')

  const stages: FlowStage[] = [
    { id: 'source' as const, label: t('gitFlowSource'), detail: primaryAddress === undefined ? t('gitNoRepository') : displayAddress(primaryAddress) },
    { id: 'scan' as const, label: t('gitFlowScan'), detail: primarySnapshot?.branch ?? (latest === undefined ? t('gitWaiting') : `${t('gitSyncStatus')}: ${syncLabel}`) },
    { id: 'changes' as const, label: t('gitFlowChanges'), detail: latest === undefined ? t('gitWaiting') : `${parseGitStatus(latest.status).length} ${t('gitWorktreeChanges')}` },
    { id: 'notify' as const, label: t('gitFlowNotify'), detail: observed ? t('gitWatching') : t('gitWaiting') },
  ]

  return <>
    <section className={css.repositoryMonitor} aria-label={t('gitMonitor')}>
      <header className={css.repositoryMonitorHeader}>
        <div>
          <h3>{t('gitMonitor')}</h3>
          <p>{activeCount} {t('gitTrackedRepositories')}</p>
        </div>
        <Tag tone={observed ? 'success' : 'quiet'}>{observed ? t('gitWatching') : t('gitWaiting')}</Tag>
      </header>
      <form className={css.repositoryAdd} onSubmit={addRepository}>
        <label htmlFor="repository-address">{t('gitAddress')}</label>
        <div className={css.repositoryAddRow}>
          <Input
            id="repository-address"
            aria-label={t('gitAddress')}
            value={draft}
            onChange={(event) => { setDraft(event.currentTarget.value) }}
            placeholder={t('gitAddressPlaceholder')}
          />
          <Button variant="primary" size="sm" type="submit" disabled={draft.trim() === ''}>{t('gitAdd')}</Button>
        </div>
        {branches.length > 0 && <div className={css.repositoryBranchPicker}>
          <label htmlFor="repository-branch">{t('gitBranchSelect')}</label>
          <select id="repository-branch" aria-label={t('gitBranchSelect')} value={branch} onChange={(event) => { setBranch(event.currentTarget.value) }}>
            {branches.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>}
        {branchesError !== null && <p className={css.repositoryBranchError} role="status">{t('gitBranchLoadFailed')}: {branchesError}</p>}
        {addressError !== null && <p className={css.gitError} role="alert">{addressError}</p>}
        <label htmlFor="repository-target">{t('gitCloneTarget')}</label>
        <div className={css.repositoryAddRow}>
          <Input
            id="repository-target"
            aria-label={t('gitCloneTarget')}
            value={targetDirectory}
            onChange={(event) => { setTargetDirectory(event.currentTarget.value) }}
            placeholder={t('gitCloneTargetPlaceholder')}
          />
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={cloneRepository === undefined || !isCloneAddress(draft) || targetDirectory.trim() === '' || cloneBusy}
            onClick={() => { void cloneRepositoryIntoFolder() }}
          >{cloneBusy ? t('gitCloning') : t('gitCloneAndLink')}</Button>
        </div>
        {cloneResult !== null && <p className={css.repositoryOperationSuccess} role="status">{cloneResult.action === 'cloned' ? t('gitCloneCompleted') : t('gitSyncCompleted')}</p>}
        {cloneError !== null && <p className={css.gitError} role="alert">{cloneError}</p>}
      </form>
      {tracked.length > 0 && <ul className={css.repositoryList}>
        {tracked.map((repository) => {
          const snapshot = snapshots[repository.address]
          const matchesCheckpoint = checkpointMatchesAddress(latest, repository.address)
          const status = repositoryStatus(
            repository,
            currentPath,
            currentRemote,
            hasCheckpoint,
            snapshot !== undefined && snapshot.error === undefined,
            snapshot?.error !== undefined || (matchesCheckpoint && latest?.error !== undefined),
          )
          return <li key={repository.address} className={css.repositoryListItem}>
            <div className={css.repositoryListMain}>
              <span className={css.repositoryStatusDot} data-enabled={repository.enabled} />
              <code title={repository.address}>{displayAddress(repository.address)}</code>
              <Tag tone={status.tone}>{t(status.key)}</Tag>
              {snapshot?.branch !== undefined && snapshot.branch !== '' && <span className={css.repositoryBranch}>{snapshot.branch}</span>}
            </div>
            <div className={css.repositoryListActions}>
              <Switch checked={repository.enabled} onChange={(next) => { toggleRepository(repository.address, next) }} label={`${t('gitMonitorToggle')}: ${displayAddress(repository.address)}`} />
              <button type="button" className={css.iconButton} onClick={() => { removeRepository(repository.address) }} aria-label={t('gitRemove')} title={t('gitRemove')}>
                <IconCloseOutline16 />
              </button>
            </div>
          </li>
        })}
      </ul>}
    </section>
    <section className={css.repositoryFlow} aria-label={t('gitFlowTitle')}>
      <header className={css.repositoryFlowHeader}>
        <div>
          <h3>{t('gitFlowTitle')}</h3>
          <p>{t('gitFlowDescription')}</p>
        </div>
        <div className={css.repositoryFlowActions}>
          <div className={css.repositoryViewMode} role="tablist" aria-label={t('gitFlowTitle')}>
            <button type="button" role="tab" aria-selected={viewMode === 'tree'} onClick={() => { setViewMode('tree') }}>{t('gitViewTree')}</button>
            <button type="button" role="tab" aria-selected={viewMode === 'flow'} onClick={() => { setViewMode('flow') }}>{t('gitViewFlow')}</button>
          </div>
          <span className={css.repositoryFlowMeta}>{checkpoints.length} {t('gitCheckpointCount')}</span>
          <button type="button" className={css.iconButton} onClick={() => { setRefreshToken(value => value + 1) }} aria-label={t('gitRefresh')} title={t('gitRefresh')}>
            <IconRefreshOutline16 />
          </button>
        </div>
      </header>
      {viewMode === 'flow'
        ? <ol className={css.flowSteps}>
          {stages.map((stage) => {
            const state = stageState(stage.id, latest, observed, primarySnapshot)
            return <li key={stage.id} className={css.flowStep} data-state={state}>
              <div className={css.flowNode}>
                <span className={css.flowNodeIcon}><StageIcon stage={stage.id} /></span>
                <span className={css.flowNodeText}><b>{stage.label}</b><small title={stage.detail}>{stage.detail}</small></span>
              </div>
            </li>
          })}
        </ol>
        : <div className={css.repositoryTree}>
          <ul className={css.treeList}>
            <li>
              {stages[0] !== undefined && <TreeNode stage={stages[0]} state={stageState('source', latest, observed, primarySnapshot)} />}
              <ul className={css.treeChildren}>
                {stages.slice(1).filter(stage => stage.id !== 'notify').map((stage) => {
                  const state = stageState(stage.id, latest, observed, primarySnapshot)
                  const isChanges = stage.id === 'changes'
                  return <li key={stage.id}>
                    <TreeNode stage={stage} state={state}>
                      {isChanges && latest !== undefined && <span className={css.treeCount}>{parseGitStatus(latest.status).length}</span>}
                    </TreeNode>
                    {isChanges && latest !== undefined && parseGitStatus(latest.status).length > 0 && <ul className={css.treeChildren}>
                      {parseGitStatus(latest.status).map((file, index) => <li key={`${file.code}-${file.path}-${index}`}>
                        <div className={css.treeLeaf}><IconCodeOutline16 /><code>{file.path}</code></div>
                      </li>)}
                    </ul>}
                  </li>
                })}
                <li>
                  <div className={css.treeNode} data-state={latest?.commits && latest.commits.length > 0 ? 'done' : 'idle'}>
                    <span className={css.treeNodeIcon}><IconCodeOutline16 /></span>
                    <span className={css.treeNodeText}><b>{t('gitTreeCommits')}</b><small>{latest?.commits?.length ?? 0}</small></span>
                  </div>
                  {latest?.commits && latest.commits.length > 0 && <ul className={css.treeChildren}>
                    {latest.commits.map(commit => <li key={commit.sha}>
                      <div className={css.treeNode} data-state="done">
                        <span className={css.treeNodeIcon}><IconCodeOutline16 /></span>
                        <span className={css.treeNodeText}>
                          <b>{commit.message}</b>
                          <small>{shortCommit(commit.sha, commit.author, commit.date)}</small>
                        </span>
                      </div>
                      {commit.files.length > 0 && <ul className={css.treeChildren}>
                        {commit.files.map(file => (
                          <li key={file}>
                            <div className={css.treeLeaf}><IconCodeOutline16 /><code>{file}</code></div>
                          </li>
                        ))}
                      </ul>}
                    </li>)}
                  </ul>}
                </li>
                {stages.filter(stage => stage.id === 'notify').map(stage => <li key={stage.id}>
                  <TreeNode stage={stage} state={stageState(stage.id, latest, observed, primarySnapshot)} />
                </li>)}
              </ul>
            </li>
          </ul>
        </div>}
      {repositoryPath !== undefined && <section className={css.gitWorkspace} aria-label={t('gitLiveChanges')}>
        <header className={css.gitWorkspaceHeader}>
          <div>
            <h4>{t('gitLiveChanges')}</h4>
            <span>{repositoryPath}</span>
          </div>
          <div className={css.repositoryLiveActions}>
            {liveChanges?.branch && <code>{liveChanges.branch}</code>}
            <button type="button" className={css.iconButton} onClick={() => { setRefreshToken(value => value + 1) }} disabled={inspectBusy} aria-label={t('gitRefresh')} title={t('gitRefresh')}>
              <IconRefreshOutline16 />
            </button>
          </div>
        </header>
        {inspectBusy && <p className={css.muted}>{t('gitInspecting')}</p>}
        {inspectError !== null && <p className={css.gitError} role="alert">{t('gitInspectFailed')}: {inspectError}</p>}
        {liveChanges !== null && <>
          <div className={css.gitMetricGrid}>
            <div><span>{t('gitFilesChanged')}</span><strong>{liveStat.files ?? liveFiles.length}</strong></div>
            <div><span>{t('gitInsertions')}</span><strong>{liveStat.insertions ?? '—'}</strong></div>
            <div><span>{t('gitDeletions')}</span><strong>{liveStat.deletions ?? '—'}</strong></div>
          </div>
          <div className={css.gitSyncPanel}>
            <div><span>{t('gitSyncStatus')}</span><strong>{liveSyncLabel}</strong></div>
            <div><span>{t('gitAheadBehind')}</span><strong>{liveChanges.ahead}/{liveChanges.behind}</strong></div>
            <div><span>{t('gitLocalHead')}</span><code>{shortSha(liveChanges.localHead)}</code></div>
            {liveChanges.upstreamBranch && <div><span>{t('gitUpstream')}</span><code>{liveChanges.upstreamBranch}</code></div>}
          </div>
          {liveFiles.length === 0
            ? <p className={css.gitClean}>{t('gitNoLiveChanges')}</p>
            : <ul className={css.gitFileList}>{liveFiles.map((file, index) => <li key={`${file.code}-${file.path}-${index}`}><span className={css.gitFileKind}>{file.code}</span><code>{file.path}</code></li>)}</ul>}
          {liveChanges.diff !== '' && <details className={css.gitDiffDetails} open>
            <summary>{t('gitViewDiff')}</summary>
            <pre>{liveChanges.diff}</pre>
          </details>}
          <div className={css.repositoryPublish}>
            <label htmlFor="repository-commit-message">{t('gitCommitMessage')}</label>
            <textarea id="repository-commit-message" value={commitMessage} onChange={(event) => { setCommitMessage(event.currentTarget.value) }} placeholder={t('gitCommitMessagePlaceholder')} rows={2} />
            <label className={css.repositoryCheckbox} htmlFor="repository-include-untracked">
              <input id="repository-include-untracked" type="checkbox" checked={includeUntracked} onChange={(event) => { setIncludeUntracked(event.currentTarget.checked) }} />
              {t('gitIncludeUntracked')}
            </label>
            <button type="button" className={css.repositoryPublishButton} onClick={() => { void publishRepository() }} disabled={!canPublish}>
              {pushBusy ? t('gitPushing') : t('gitCommitAndPush')}
            </button>
            {liveChanges.remote === undefined && <p className={css.muted}>{t('gitNoRemote')}</p>}
            {pushResult !== null && <p className={css.repositoryOperationSuccess} role="status">{t('gitPushCompleted')}</p>}
            {pushError !== null && <p className={css.gitError} role="alert">{t('gitPushFailed')}: {pushError}</p>}
          </div>
        </>}
      </section>}
      {tracked.filter(item => item.enabled).map((repository) => {
        const snapshot = snapshots[repository.address]
        if (snapshot === undefined) return null
        return <section key={repository.address} className={css.commitTimeline} aria-label={`${t('gitCommitTimeline')}: ${repository.address}`}>
          <header><b>{snapshot.name}</b><span>{snapshot.branch}</span></header>
          {snapshot.error !== undefined
            ? <p className={css.gitError}>{snapshot.error}</p>
            : snapshot.commits.length === 0
              ? <p className={css.muted}>{t('gitNoCommits')}</p>
              : <ol>{snapshot.commits.map(commit => <li key={commit.sha}>
                <span className={css.commitDot} />
                <a href={commit.url} target="_blank" rel="noreferrer"><code>{commit.sha.slice(0, 7)}</code><b>{commit.message}</b></a>
                <small>{commit.author || t('gitUnknownAuthor')}{commit.date === null ? '' : ` · ${new Date(commit.date).toLocaleString()}`}</small>
              </li>)}</ol>}
        </section>
      })}
    </section>
  </>
}
