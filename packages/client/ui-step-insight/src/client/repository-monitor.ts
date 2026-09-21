/** Public GitHub repository polling used by the browser-only monitor. */

export interface GitHubRepositoryRef {
  owner: string
  repo: string
}

export interface HostedRepositoryRef extends GitHubRepositoryRef {
  host: 'github.com' | 'gitcode.com'
}

/** Normalize an HTTPS or SCP-style Git remote for local checkpoint matching. */
export function normalizeRepositoryAddress(address: string): string | null {
  const value = address.trim().replace(/^git\+/u, '')
  let host: string
  let path: string
  const scp = /^git@([^:]+):(.+)$/u.exec(value)
  if (scp !== null) {
    host = scp[1] ?? ''
    path = scp[2] ?? ''
  } else {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) return null
      host = url.hostname
      path = url.pathname
    } catch {
      return null
    }
  }
  const parts = path.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  const owner = parts[0]
  const repo = parts[1]?.replace(/\.git$/u, '')
  if (owner === undefined || repo === undefined || repo === '') return null
  return `${host.toLowerCase()}/${owner}/${repo}`
}

export interface GitHubCommitSummary {
  sha: string
  message: string
  author: string
  date: string | null
  url: string
}

export interface RepositorySnapshot {
  address: string
  name: string
  branch: string
  commits: readonly GitHubCommitSummary[]
  fetchedAt: number
  error?: string
}

/** Extract a public GitHub or GitCode owner/repository pair from a URL. */
export function parseHostedRepositoryAddress(address: string): HostedRepositoryRef | null {
  try {
    const url = new URL(address.trim())
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (host !== 'github.com' && host !== 'gitcode.com') return null
    const parts = url.pathname.split('/').filter(Boolean).map(part => part.replace(/\.git$/u, ''))
    if (parts.length < 2 || parts[0] === undefined || parts[1] === undefined) return null
    return { host, owner: parts[0], repo: parts[1] }
  } catch {
    return null
  }
}

/** Extract a public GitHub owner/repository pair from a user-entered URL. */
export function parseGitHubAddress(address: string): GitHubRepositoryRef | null {
  const ref = parseHostedRepositoryAddress(address)
  return ref?.host === 'github.com' ? { owner: ref.owner, repo: ref.repo } : null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function commitSummary(value: unknown): GitHubCommitSummary | null {
  const item = record(value)
  const commit = record(item?.commit)
  const author = record(commit?.author)
  const sha = stringValue(item?.sha)
  const message = stringValue(commit?.message)
  const url = stringValue(item?.html_url)
  if (sha === null || message === null || url === null) return null
  return {
    sha,
    message: message.split(/\r?\n/u, 1)[0] ?? message,
    author: stringValue(author?.name) ?? '',
    date: stringValue(author?.date),
    url,
  }
}

async function jsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<unknown>
}

function requestInit(signal: AbortSignal | undefined): RequestInit {
  return signal === undefined ? { headers: { Accept: 'application/vnd.github+json' } } : {
    headers: { Accept: 'application/vnd.github+json' }, signal,
  }
}

/** Fetch a bounded public GitHub repository timeline without credentials. */
export async function fetchRepositorySnapshot(address: string, signal?: AbortSignal): Promise<RepositorySnapshot> {
  const ref = parseHostedRepositoryAddress(address)
  if (ref === null) throw new Error('Only public GitHub or GitCode HTTPS URLs are supported')
  const base = ref.host === 'github.com'
    ? `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`
    : `https://api.gitcode.com/api/v5/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`
  const repo = ref.host === 'github.com' ? record(await jsonResponse(await fetch(base, requestInit(signal)))) : null
  const branch = stringValue(repo?.default_branch) ?? 'main'
  const commitsResponse = await fetch(`${base}/commits?per_page=8`, requestInit(signal))
  const commitsPayload = await jsonResponse(commitsResponse)
  const commits = Array.isArray(commitsPayload) ? commitsPayload.flatMap((value) => {
    const summary = commitSummary(value)
    return summary === null ? [] : [summary]
  }) : []
  return { address, name: `${ref.owner}/${ref.repo}`, branch, commits, fetchedAt: Date.now() }
}
