/** Git workspace evidence and guarded checkout operations for local Web sessions. */

import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { execFile, spawn } from 'node:child_process'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import schema from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

const execFileAsync = promisify(execFile)

export interface Config {
  /** Whether to capture checkpoints for session turns. */
  enabled?: boolean
  /** Maximum UTF-8 bytes retained from `git status`. */
  maxStatusBytes?: number
  /** Maximum UTF-8 bytes retained from `git diff --stat`. */
  maxDiffStatBytes?: number
  /** Maximum UTF-8 bytes retained from the unified diff. */
  maxDiffBytes?: number
  /** Maximum number of commits retained in each checkpoint. */
  maxCommits?: number
  /** Maximum files retained per commit. */
  maxCommitFiles?: number
}

export interface GitCommitAudit {
  sha: string
  message: string
  author: string
  date: string | null
  files: string[]
}

export type GitSyncState = 'synced' | 'remote-ahead' | 'local-ahead' | 'diverged' | 'different' | 'unknown'

/** Canonical GitCode source used by the in-app source checkout updater. */
export const UPDATE_REPOSITORY_URL = 'https://gitcode.com/XJ-Cyber/lingda-harness.git'
const UPDATE_DEFAULT_BRANCH = 'main'
const UPDATE_REMOTE_NAME = 'gitcode'

/** Repository state exposed to the Settings update row. */
export interface RepositoryUpdateStatus {
  repositoryRoot: string
  remote: string
  branch: string
  remoteBranch: string
  localHead: string
  remoteHead: string
  ahead: number
  behind: number
  state: 'current' | 'available' | 'local-ahead' | 'diverged' | 'blocked'
  reason?: string
}

/** Result returned after a successful source update. */
export interface RepositoryUpdateResult extends RepositoryUpdateStatus {
  updated: boolean
  restartScheduled: boolean
}

/** A user-requested remote checkout target. Paths are interpreted by the Host. */
export interface RepositoryCloneRequest {
  url: string
  targetDirectory: string
  branch?: string
}

/** Result of cloning a new checkout or fast-forwarding an existing checkout. */
export interface RepositoryCloneResult {
  repositoryRoot: string
  remote: string
  branch: string
  localHead: string
  remoteHead?: string
  action: 'cloned' | 'synced' | 'current'
  changed: boolean
}

/** Branch names advertised by a remote repository. */
export interface RepositoryBranchesResult {
  url: string
  branches: string[]
}

/** A bounded live view of one local checkout. */
export interface RepositoryChangeSnapshot {
  repositoryRoot: string
  remote?: string
  branch: string
  localHead: string
  upstreamBranch?: string
  upstreamHead?: string
  ahead: number
  behind: number
  syncState: GitSyncState
  status: string
  diffStat: string
  diff: string
}

/** Explicit publish request from the repository surface. */
export interface RepositoryPushRequest {
  repositoryRoot: string
  message?: string
  includeUntracked?: boolean
}

/** Result after committing local changes and pushing the selected branch. */
export interface RepositoryPushResult extends RepositoryChangeSnapshot {
  committed: boolean
  pushed: boolean
  commitSha?: string
}

export interface GitCheckpoint {
  turn: number
  phase: 'before' | 'after'
  cwd: string
  /** Repository root used for the read-only commands when cwd is a workspace parent. */
  repositoryRoot?: string
  /** Origin URL when the local repository has one. */
  remote?: string
  branch?: string
  upstreamBranch?: string
  localHead?: string
  upstreamHead?: string
  remoteHead?: string
  ahead?: number
  behind?: number
  syncState?: GitSyncState
  remoteError?: string
  commits?: GitCommitAudit[]
  status?: string
  diffStat?: string
  diff?: string
  error?: string
}

export type { GitCheckpoint as GitCheckpointAudit }

declare module '@deepseek-ai/cordis' {
  interface Context {
    gitWorkspace: GitWorkspaceService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Bounded, read-only Git state captured at a turn boundary. */
    'agent/git-checkpoint': GitCheckpoint
  }
}

function truncate(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let output = value.slice(0, maxBytes)
  while (Buffer.byteLength(output, 'utf8') > Math.max(0, maxBytes - 32)) output = output.slice(0, -1)
  return `${output}\n[Git 输出已截断]`
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000)
}

async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', [...args], {
    cwd, maxBuffer: 64 * 1024, encoding: 'utf8',
  })
  return result.stdout.trim()
}

function normalizedRemote(value: string): string {
  return value.trim().replace(/\.git$/u, '').replace(/\/+$/u, '').toLowerCase()
}

function validRepositoryUrl(value: string): boolean {
  const url = value.trim()
  if (url === '' || /[\0\r\n]/u.test(url)) return false
  if (/^https:\/\/[^\s]+$/iu.test(url)) return true
  if (/^ssh:\/\/[^\s]+$/iu.test(url)) return true
  return /^git@[^\s:]+:[^\s]+$/u.test(url)
}

function validBranchName(value: string): boolean {
  return value === '' || (!/[\0\r\n]/u.test(value) && !value.startsWith('-') && !value.includes('..'))
}

async function listRemoteBranches(url: string): Promise<RepositoryBranchesResult> {
  const normalizedUrl = url.trim()
  if (!validRepositoryUrl(normalizedUrl)) throw new Error('仅支持 HTTPS 或 SSH Git 仓库地址')
  const output = (await execFileAsync('git', ['ls-remote', '--heads', '--', normalizedUrl], {
    maxBuffer: 256 * 1024, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })).stdout
  const branches = output.split(/\r?\n/u).flatMap((line) => {
    const ref = line.trim().split(/\s+/u)[1]
    return ref?.startsWith('refs/heads/') ? [ref.slice('refs/heads/'.length)] : []
  }).filter((branch, index, values) => values.indexOf(branch) === index).sort()
  return { url: normalizedUrl, branches }
}

async function directoryState(path: string): Promise<'missing' | 'empty' | 'non-empty' | 'file'> {
  try {
    const stat = await lstat(path)
    if (!stat.isDirectory()) return 'file'
    const entries = await readdir(path)
    return entries.length === 0 ? 'empty' : 'non-empty'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

async function repositoryRemote(root: string): Promise<string | undefined> {
  try {
    const remote = await gitOutput(root, ['remote', 'get-url', 'origin'])
    return remote === '' ? undefined : remote
  } catch {
    return undefined
  }
}

/** Include bounded pseudo-diffs for untracked text files, which git diff omits. */
async function untrackedDiff(root: string): Promise<string> {
  const names = await gitOutput(root, ['ls-files', '--others', '--exclude-standard', '-z']).catch(() => '')
  const paths = names.split('\0').filter(path => path !== '' && !path.startsWith('/') && !path.includes('\0'))
  const chunks: string[] = []
  for (const path of paths) {
    try {
      await execFileAsync('git', ['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', join(root, path)], {
        cwd: root, maxBuffer: 64 * 1024, encoding: 'utf8', timeout: 5_000,
      })
    } catch (error) {
      const output = (error as { stdout?: unknown }).stdout
      if (typeof output === 'string' && output !== '') chunks.push(output)
    }
  }
  return chunks.join('\n')
}

async function repositorySnapshot(root: string): Promise<RepositoryChangeSnapshot> {
  const branch = await gitOutput(root, ['branch', '--show-current'])
  if (branch === '') throw new Error('当前仓库处于 detached HEAD，无法执行推送')
  const status = await gitOutput(root, ['status', '--short', '--branch'])
  const statusLines = status.split(/\r?\n/u).filter(Boolean)
  const branchLine = statusLines.find(line => line.startsWith('## '))
  const counts = parseTrackingCounts(branchLine?.slice(3))
  const upstreamBranch = await gitOutput(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')
  const upstreamHead = await gitOutput(root, ['rev-parse', '@{upstream}']).catch(() => '')
  const localHead = await gitOutput(root, ['rev-parse', 'HEAD'])
  const remote = await repositoryRemote(root)
  let remoteHead: string | undefined
  if (remote !== undefined) {
    try { remoteHead = (await readRemoteHead(root, remote)).sha } catch { /* status remains useful without the network */ }
  }
  const ahead = counts.ahead ?? 0
  const behind = counts.behind ?? 0
  const state = syncState(localHead, upstreamHead || undefined, remoteHead, ahead, behind) ?? 'unknown'
  const diffStat = await gitOutput(root, ['diff', 'HEAD', '--stat']).catch(() => '')
  const trackedDiff = await gitOutput(root, ['diff', 'HEAD', '--no-ext-diff', '--unified=3']).catch(() => '')
  const untracked = await untrackedDiff(root)
  const diff = [trackedDiff, untracked].filter(Boolean).join('\n')
  return {
    repositoryRoot: root,
    ...(remote === undefined ? {} : { remote }),
    branch,
    localHead,
    ...(upstreamBranch === '' ? {} : { upstreamBranch }),
    ...(upstreamHead === '' ? {} : { upstreamHead }),
    ahead,
    behind,
    syncState: state,
    status: statusLines.filter(line => !line.startsWith('## ')).join('\n'),
    diffStat,
    diff: truncate(diff, 120_000),
  }
}

function repositoryRootFromRequest(requested: string): Promise<string> {
  const path = requested.trim()
  if (!isAbsolute(path)) throw new Error('仓库路径必须是绝对路径')
  return gitOutput(resolve(path), ['rev-parse', '--show-toplevel']).then((root) => {
    return Promise.all([realpath(resolve(root)), realpath(resolve(path))]).then(([normalized, requestedRoot]) => {
      if (normalized !== requestedRoot) throw new Error('请指定仓库根目录')
      return normalized
    })
  }).catch((error) => {
    if (error instanceof Error && /请指定仓库根目录/u.test(error.message)) throw error
    throw new Error('目标路径不是 Git 仓库')
  })
}

async function pushRepository(request: RepositoryPushRequest): Promise<RepositoryPushResult> {
  const root = await repositoryRootFromRequest(request.repositoryRoot)
  const before = await repositorySnapshot(root)
  if (before.remote === undefined) throw new Error('仓库没有 origin 远端，无法推送')
  await execFileAsync('git', ['fetch', '--prune', 'origin'], {
    cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 512 * 1024, encoding: 'utf8', timeout: 120_000,
  })
  const refreshed = await repositorySnapshot(root)
  if (refreshed.behind > 0 && refreshed.ahead > 0) throw new Error('本地与远端已分叉，请先手动解决冲突')
  if (refreshed.behind > 0) throw new Error('远端有新提交，请先同步后再推送')
  const message = request.message?.trim() ?? ''
  const dirty = refreshed.status.trim() !== ''
  if (dirty && message === '') throw new Error('请填写提交说明后再推送')
  if (dirty) {
    if (request.includeUntracked !== false) await execFileAsync('git', ['add', '--all'], { cwd: root, maxBuffer: 128 * 1024, encoding: 'utf8' })
    else await execFileAsync('git', ['add', '--update'], { cwd: root, maxBuffer: 128 * 1024, encoding: 'utf8' })
    await execFileAsync('git', ['commit', '-m', message], { cwd: root, maxBuffer: 512 * 1024, encoding: 'utf8' })
  }
  const current = await repositorySnapshot(root)
  if (current.behind > 0 && current.ahead > 0) throw new Error('本地与远端已分叉，请先手动解决冲突')
  if (current.behind > 0) throw new Error('远端有新提交，请先同步后再推送')
  const branch = current.branch
  await execFileAsync('git', ['push', '--set-upstream', 'origin', branch], {
    cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 512 * 1024, encoding: 'utf8', timeout: 120_000,
  })
  const after = await repositorySnapshot(root)
  return {
    ...after,
    committed: dirty,
    pushed: current.ahead > 0 || dirty,
    ...(dirty ? { commitSha: after.localHead } : {}),
  }
}

async function cloneOrSyncRepository(request: RepositoryCloneRequest): Promise<RepositoryCloneResult> {
  const url = request.url.trim()
  const target = resolve(request.targetDirectory.trim())
  if (!validRepositoryUrl(url)) throw new Error('仅支持 HTTPS 或 SSH Git 仓库地址')
  if (!isAbsolute(request.targetDirectory.trim())) throw new Error('目标文件夹必须是绝对路径')
  const branch = request.branch?.trim() ?? ''
  if (!validBranchName(branch)) throw new Error('分支名称无效')
  if (target === dirname(target)) throw new Error('目标文件夹路径无效')

  const state = await directoryState(target)
  if (state === 'file') throw new Error('目标路径不是文件夹')
  if (state === 'non-empty') {
    let root: string
    try {
      root = await gitOutput(target, ['rev-parse', '--show-toplevel'])
    } catch {
      throw new Error('目标文件夹不为空，无法安全克隆；请选择空文件夹')
    }
    if (resolve(root) !== target) throw new Error('目标文件夹不是仓库根目录')
    const existingRemote = await repositoryRemote(root)
    if (existingRemote === undefined || normalizedRemote(existingRemote) !== normalizedRemote(url)) {
      throw new Error('目标文件夹已关联其他远端仓库')
    }
    const dirty = await repositoryStatus(root)
    if (dirty !== '') throw new Error('目标仓库有未提交修改，请先提交或保存后再同步')
    const before = await gitOutput(root, ['rev-parse', 'HEAD'])
    await execFileAsync('git', ['pull', '--ff-only', '--prune'], {
      cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 512 * 1024, encoding: 'utf8', timeout: 120_000,
    })
    const after = await gitOutput(root, ['rev-parse', 'HEAD'])
    return {
      repositoryRoot: root,
      remote: existingRemote,
      branch: await gitOutput(root, ['branch', '--show-current']),
      localHead: after,
      action: before === after ? 'current' : 'synced',
      changed: before !== after,
    }
  }

  const cloneArgs = ['clone', ...(branch === '' ? [] : ['--branch', branch]), '--', url, target]
  await execFileAsync('git', cloneArgs, {
    cwd: dirname(target), env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 512 * 1024, encoding: 'utf8', timeout: 600_000,
  })
  const root = await gitOutput(target, ['rev-parse', '--show-toplevel'])
  return {
    repositoryRoot: root,
    remote: await repositoryRemote(root) ?? url,
    branch: await gitOutput(root, ['branch', '--show-current']),
    localHead: await gitOutput(root, ['rev-parse', 'HEAD']),
    action: 'cloned',
    changed: true,
  }
}

function commandName(name: string): string {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

async function repositoryStatus(root: string): Promise<string> {
  return gitOutput(root, ['status', '--porcelain', '--untracked-files=all'])
}

interface RemoteHead {
  ref?: string
  sha?: string
}

function parseRemoteHead(output: string): RemoteHead {
  const result: RemoteHead = {}
  const ref = /^ref:\s+(refs\/heads\/[^\s]+)\s+HEAD$/mu.exec(output)?.[1]
  const sha = /^(?<sha>[0-9a-f]{7,64})\s+HEAD$/mu.exec(output)?.groups?.sha
  if (ref !== undefined) result.ref = ref
  if (sha !== undefined) result.sha = sha
  return result
}

/** Read the remote HEAD, tolerating servers that do not support --symref. */
async function readRemoteHead(root: string, remote: string): Promise<RemoteHead> {
  let output: string
  try {
    output = (await execFileAsync('git', ['ls-remote', '--symref', remote, 'HEAD'], {
      cwd: root, maxBuffer: 64 * 1024, encoding: 'utf8', timeout: 1_500,
    })).stdout.trim()
  } catch {
    output = (await execFileAsync('git', ['ls-remote', remote, 'HEAD'], {
      cwd: root, maxBuffer: 64 * 1024, encoding: 'utf8', timeout: 1_500,
    })).stdout.trim()
  }
  return parseRemoteHead(output)
}

async function remoteBranch(root: string, remote: string): Promise<string> {
  try {
    const branch = (await readRemoteHead(root, remote)).ref
      ?.replace(/^refs\/heads\//u, '')
    if (branch !== undefined) return branch
  } catch {
    // Fall through to the local branch when the remote does not advertise HEAD.
  }
  // GitCode's repository currently uses `main`; keep checks usable when a
  // transient ls-remote failure prevents reading its advertised HEAD.
  return UPDATE_DEFAULT_BRANCH
}

async function fetchUpdateRemote(root: string, branch: string): Promise<void> {
  // Fetch the canonical source into a stable tracking ref even when the
  // checkout was cloned without a `gitcode` remote. This keeps update checks
  // read-only with respect to tracked files while making the later fast-forward
  // merge deterministic.
  await execFileAsync('git', [
    'fetch', '--prune', UPDATE_REPOSITORY_URL,
    `+refs/heads/${branch}:refs/remotes/${UPDATE_REMOTE_NAME}/${branch}`,
  ], {
    cwd: root, maxBuffer: 256 * 1024, encoding: 'utf8', timeout: 120_000,
  })
}

async function repositoryUpdateStatus(root: string, fetchRemote: boolean): Promise<RepositoryUpdateStatus> {
  const branch = await gitOutput(root, ['branch', '--show-current'])
  if (branch === '') throw new Error('当前仓库处于 detached HEAD，无法自动更新')
  const dirty = await repositoryStatus(root)
  const remote = UPDATE_REMOTE_NAME
  const remoteBranchName = await remoteBranch(root, UPDATE_REPOSITORY_URL)
  const remoteRef = `refs/remotes/${remote}/${remoteBranchName}`
  if (fetchRemote) await fetchUpdateRemote(root, remoteBranchName)
  const localHead = await gitOutput(root, ['rev-parse', 'HEAD'])
  const remoteHead = await gitOutput(root, ['rev-parse', remoteRef])
  const counts = await gitOutput(root, ['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`])
  const [ahead = 0, behind = 0] = counts.split(/\s+/u).map(value => Number(value))
  const state = dirty !== ''
    ? 'blocked'
    : ahead > 0 && behind > 0
      ? 'diverged'
      : ahead > 0
        ? 'local-ahead'
        : behind > 0
          ? 'available'
          : 'current'
  return {
    repositoryRoot: root,
    remote,
    branch,
    remoteBranch: remoteBranchName,
    localHead,
    remoteHead,
    ahead,
    behind,
    state,
    ...(dirty === '' ? {} : { reason: '工作区有未提交修改，请先提交或保存后再更新' }),
    ...(state === 'diverged' ? { reason: '本地分支与远程分支已分叉，请先手动处理冲突' } : {}),
  }
}

async function runBuild(root: string, command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(commandName(command), args, {
    cwd: root,
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
  })
}

function scheduleProcessRestart(root: string, exit: ((code: number) => void) | undefined): boolean {
  if (exit === undefined || process.env.DSH_DISABLE_AUTO_RESTART === '1') return false
  const restartArgs = JSON.stringify(process.argv.slice(1))
  const execArgs = JSON.stringify(process.execArgv)
  const helper = [
    "const { spawn } = require('node:child_process')",
    "setTimeout(() => { const child = spawn(process.argv[1], [...JSON.parse(process.argv[2]), ...JSON.parse(process.argv[3])], { cwd: process.argv[4], env: process.env, detached: true, stdio: 'ignore' }); child.unref() }, 1000)",
  ].join(';')
  const child = spawn(process.execPath, ['-e', helper, process.execPath, execArgs, restartArgs, root], {
    cwd: root, env: process.env, detached: true, stdio: 'ignore',
  })
  child.unref()
  setTimeout(() => { exit(0) }, 250)
  return true
}

function parseTrackingCounts(branch: string | undefined): { ahead?: number; behind?: number } {
  if (branch === undefined) return {}
  const match = /\[(?<values>[^\]]+)\]/u.exec(branch)
  if (match?.groups?.values === undefined) return {}
  const result: { ahead?: number; behind?: number } = {}
  for (const value of match.groups.values.split(',')) {
    const item = value.trim().match(/^(ahead|behind)\s+(\d+)$/u)
    if (item === null) continue
    const count = Number(item[2])
    if (item[1] === 'ahead') result.ahead = count
    else result.behind = count
  }
  return result
}

function syncState(
  localHead: string | undefined,
  upstreamHead: string | undefined,
  remoteHead: string | undefined,
  ahead: number | undefined,
  behind: number | undefined,
): GitSyncState | undefined {
  if (localHead !== undefined && remoteHead !== undefined) {
    if (localHead === remoteHead) return 'synced'
    if (upstreamHead !== undefined && upstreamHead !== remoteHead) {
      if ((ahead ?? 0) > 0 || (behind ?? 0) > 0) return 'diverged'
      return 'remote-ahead'
    }
  }
  if (ahead !== undefined || behind !== undefined) {
    const localAhead = ahead ?? 0
    const remoteBehind = behind ?? 0
    if (localAhead === 0 && remoteBehind === 0) return 'synced'
    if (localAhead > 0 && remoteBehind > 0) return 'diverged'
    if (localAhead > 0) return 'local-ahead'
    return 'remote-ahead'
  }
  if (localHead !== undefined && upstreamHead !== undefined) return localHead === upstreamHead ? 'synced' : 'different'
  if (localHead !== undefined && remoteHead !== undefined) return localHead === remoteHead ? 'synced' : 'different'
  return undefined
}

function parseCommitLog(output: string, maxCommits: number): GitCommitAudit[] {
  return output.split('\x1e').flatMap((record) => {
    const header = record.trim().split(/\r?\n/u)[0]?.split('\x1f')
    if (header === undefined || header.length < 4
      || header[0] === undefined || header[1] === undefined
      || header[2] === undefined || header[3] === undefined) return []
    return [{
      sha: header[0], author: header[1], date: header[2] || null, message: header[3],
      files: [],
    }]
  }).slice(0, maxCommits)
}

/** Resolve a repo from the session cwd, including a single direct child repo. */
async function resolveRepositoryRoot(cwd: string): Promise<string | undefined> {
  try {
    return await gitOutput(cwd, ['rev-parse', '--show-toplevel'])
  } catch {
    try {
      const entries = await readdir(cwd, { withFileTypes: true })
      const roots = new Set<string>()
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        try {
          roots.add(await gitOutput(join(cwd, entry.name), ['rev-parse', '--show-toplevel']))
        } catch {
          // Ignore non-repository children and keep the session usable.
        }
        if (roots.size > 1) return undefined
      }
      return roots.values().next().value as string | undefined
    } catch {
      return undefined
    }
  }
}

/**
 * Captures Git metadata independently from Agent modes so the evidence is
 * available to presets, CLI sessions, and the Web trajectory alike. Checkout
 * operations are explicit, path-checked, and fast-forward only for existing
 * repositories.
 */
export class GitWorkspaceService extends TypertRemoteService {
  static Config: schema<Config> = schema.object({
    enabled: schema.boolean().default(true),
    maxStatusBytes: schema.number().step(1).min(256).default(24_000),
    maxDiffStatBytes: schema.number().step(1).min(256).default(4_000),
    maxDiffBytes: schema.number().step(1).min(256).default(24_000),
    maxCommits: schema.number().step(1).min(1).default(8),
    maxCommitFiles: schema.number().step(1).min(1).default(24),
  }) as schema<Config>

  private readonly config: Required<Config>
  private readonly queues = new WeakMap<Session, Promise<void>>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'gitWorkspace')
    this.config = {
      enabled: config.enabled !== false,
      maxStatusBytes: config.maxStatusBytes ?? 24_000,
      maxDiffStatBytes: config.maxDiffStatBytes ?? 4_000,
      maxDiffBytes: config.maxDiffBytes ?? 24_000,
      maxCommits: config.maxCommits ?? 8,
      maxCommitFiles: config.maxCommitFiles ?? 24,
    }

    ctx.on('session/event', (session, event) => {
      if (!this.config.enabled) return
      if (event.type === 'turn/start') this.schedule(session, event.data.turn, 'before')
      else if (event.type === 'turn/end') this.schedule(session, event.data.turn, 'after')
    })
    // Re-check resumed sessions immediately. Historical checkpoints may have
    // been captured before a repository was initialized or before this
    // service learned how to resolve a nested worktree.
    ctx.on('session/created', (session) => {
      if (!this.config.enabled) return
      const checkpoint = session.snapshotEvents().findLast(event => event.type === 'agent/git-checkpoint')
      if (checkpoint?.type === 'agent/git-checkpoint') this.schedule(session, checkpoint.data.turn, 'after')
    })
    ctx.on('session/flush', async (session) => {
      await this.queues.get(session)
    })
  }

  /** Check the canonical GitCode source without changing tracked files. */
  @Remote('check')
  async check(): Promise<RepositoryUpdateStatus> {
    const root = await resolveRepositoryRoot(process.cwd())
    if (root === undefined) throw new Error('当前进程目录不是 Git 仓库')
    return repositoryUpdateStatus(root, true)
  }

  /** Clone a remote into a new folder, or fast-forward the matching checkout. */
  @Remote('clone')
  async clone(request: RepositoryCloneRequest): Promise<RepositoryCloneResult> {
    return cloneOrSyncRepository(request)
  }

  /** Read branch names advertised by a remote without changing local files. */
  @Remote('branches')
  async branches(url: string): Promise<RepositoryBranchesResult> {
    return listRemoteBranches(url)
  }

  /** Read the current checkout, worktree status, and bounded unified diff. */
  @Remote('inspect')
  async inspect(repositoryRoot: string): Promise<RepositoryChangeSnapshot> {
    return repositorySnapshot(await repositoryRootFromRequest(repositoryRoot))
  }

  /** Commit explicit local changes and push the current branch to origin. */
  @Remote('push')
  async push(request: RepositoryPushRequest): Promise<RepositoryPushResult> {
    return pushRepository(request)
  }

  /** Fast-forward the checkout, install locked dependencies, build, and restart the Host. */
  @Remote('update')
  async update(): Promise<RepositoryUpdateResult> {
    const root = await resolveRepositoryRoot(process.cwd())
    if (root === undefined) throw new Error('当前进程目录不是 Git 仓库')
    const before = await repositoryUpdateStatus(root, true)
    if (before.state === 'blocked') throw new Error(before.reason ?? '工作区不满足自动更新条件')
    if (before.state === 'diverged' || before.state === 'local-ahead') {
      throw new Error(before.reason ?? '本地分支不支持自动快进更新')
    }
    if (before.state === 'current') {
      return { ...before, updated: false, restartScheduled: false }
    }
    await execFileAsync('git', ['merge', '--ff-only', `refs/remotes/${before.remote}/${before.remoteBranch}`], {
      cwd: root, maxBuffer: 512 * 1024, encoding: 'utf8',
    })
    await runBuild(root, 'pnpm', ['install', '--frozen-lockfile'])
    await runBuild(root, 'pnpm', ['run', 'build'])
    const after = await repositoryUpdateStatus(root, false)
    const exit = this.ctx.get('appExit') as ((code: number) => void) | undefined
    return {
      ...after,
      updated: true,
      restartScheduled: scheduleProcessRestart(root, exit),
    }
  }

  private schedule(session: Session, turn: number, phase: 'before' | 'after'): void {
    const previous = this.queues.get(session) ?? Promise.resolve()
    const next = previous.then(() => this.capture(session, turn, phase))
    this.queues.set(session, next.catch(() => undefined))
  }

  private async capture(session: Session, turn: number, phase: 'before' | 'after'): Promise<void> {
    const cwd = session.header.cwd
    if (cwd === undefined || cwd.trim() === '') return
    const repositoryRoot = await resolveRepositoryRoot(cwd)
    const commandCwd = repositoryRoot ?? cwd
    const result: GitCheckpoint = { turn, phase, cwd, ...(repositoryRoot === undefined ? {} : { repositoryRoot }) }
    const errors: string[] = []

    try {
      const status = await execFileAsync('git', ['status', '--short', '--branch'], {
        cwd: commandCwd, maxBuffer: Math.max(64 * 1024, this.config.maxStatusBytes * 2), encoding: 'utf8',
      })
      const lines = status.stdout.trimEnd().split('\n').filter(Boolean)
      const branch = lines.find(line => line.startsWith('## '))
      if (branch !== undefined) result.branch = truncate(branch.slice(3), 500)
      result.status = truncate(lines.filter(line => !line.startsWith('## ')).join('\n'), this.config.maxStatusBytes)
      const counts = parseTrackingCounts(result.branch)
      if (counts.ahead !== undefined) result.ahead = counts.ahead
      if (counts.behind !== undefined) result.behind = counts.behind
    } catch (error) {
      errors.push(`status: ${errorText(error)}`)
    }

    try {
      const stat = await execFileAsync('git', ['diff', 'HEAD', '--stat'], {
        cwd: commandCwd, maxBuffer: Math.max(64 * 1024, this.config.maxDiffStatBytes * 2), encoding: 'utf8',
      })
      result.diffStat = truncate(stat.stdout.trim(), this.config.maxDiffStatBytes)
    } catch (error) {
      errors.push(`diff --stat: ${errorText(error)}`)
    }

    try {
      const diff = await execFileAsync('git', ['diff', 'HEAD', '--no-ext-diff', '--unified=3'], {
        cwd: commandCwd, maxBuffer: Math.max(64 * 1024, this.config.maxDiffBytes * 2), encoding: 'utf8',
      })
      result.diff = truncate(diff.stdout, this.config.maxDiffBytes)
    } catch (error) {
      errors.push(`diff: ${errorText(error)}`)
    }

    if (repositoryRoot !== undefined) {
      try {
        result.localHead = await gitOutput(commandCwd, ['rev-parse', 'HEAD'])
      } catch (error) {
        errors.push(`head: ${errorText(error)}`)
      }

      try {
        result.upstreamBranch = await gitOutput(commandCwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
        result.upstreamHead = await gitOutput(commandCwd, ['rev-parse', '@{upstream}'])
        const counts = await gitOutput(commandCwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
        const [localAhead, remoteBehind] = counts.split(/\s+/u).map(Number)
        if (localAhead !== undefined && Number.isFinite(localAhead)) result.ahead = localAhead
        if (remoteBehind !== undefined && Number.isFinite(remoteBehind)) result.behind = remoteBehind
      } catch {
        // A repository may not have an upstream configured yet.
      }

      try {
        const log = (await execFileAsync('git', [
          'log', `-${this.config.maxCommits}`, '--date=iso-strict', '--format=%H%x1f%an%x1f%aI%x1f%s%x1e',
        ], {
          cwd: commandCwd, maxBuffer: 64 * 1024, encoding: 'utf8',
        })).stdout.trim()
        result.commits = parseCommitLog(log, this.config.maxCommits)
        for (const commit of result.commits) {
          try {
            const files = (await execFileAsync('git', ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', commit.sha], {
              cwd: commandCwd, maxBuffer: 256 * 1024, encoding: 'utf8',
            })).stdout
            commit.files = files.split(/\r?\n/u).map(file => file.trim()).filter(Boolean).slice(0, this.config.maxCommitFiles)
          } catch {
            // Commit metadata remains useful when a very large file list is bounded out.
          }
        }
      } catch {
        // A repository without commits still has useful status evidence.
      }

      let remoteName: string | undefined
      const trackingRemote = result.upstreamBranch?.split('/')[0]
      const remoteCandidates = [trackingRemote, 'origin', 'upstream'].filter((value, index, values): value is string => value !== undefined && values.indexOf(value) === index)
      for (const candidate of remoteCandidates) {
        try {
          const remote = await gitOutput(commandCwd, ['remote', 'get-url', candidate])
          if (remote !== '') {
            result.remote = truncate(remote, 1_000)
            remoteName = candidate
            break
          }
        } catch {
          // Keep trying the next configured remote.
        }
      }

      if (remoteName !== undefined) {
        try {
          const remoteHead = await readRemoteHead(commandCwd, remoteName)
          if (remoteHead.ref !== undefined) result.upstreamBranch ??= remoteHead.ref
          if (remoteHead.sha !== undefined) result.remoteHead = remoteHead.sha
        } catch (error) {
          result.remoteError = errorText(error)
        }
      }
      const state = syncState(result.localHead, result.upstreamHead, result.remoteHead, result.ahead, result.behind)
      if (state !== undefined) result.syncState = state
    }

    if (errors.length > 0) result.error = errors.join('\n').slice(0, 2_000)
    try {
      session.append('agent/git-checkpoint', result, { ignorable: true })
    } catch (error) {
      this.ctx.logger.warn(`git-workspace: unable to persist checkpoint: ${errorText(error)}`)
    }
  }
}

export default GitWorkspaceService
