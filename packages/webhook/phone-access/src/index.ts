/**
 * Phone QR access: one ngrok tunnel for the running DSH Web GUI.
 *
 * The free ngrok domain is only known after the tunnel starts, while the
 * browser trust list is fixed at process boot, so the card shows a restart
 * command and this process never restarts itself. The tunnel dies with the
 * process that opened it.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { Context, Service } from '@deepseek-ai/cordis'
// Type-only: the ctx.webServer and ctx.connection service declarations.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { PhoneAccessView } from './types.ts'

export type { PhoneAccessView } from './types.ts'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'

/** ngrok's loopback inspector. The tunnel address is read from here, never guessed. */
const NGROK_API = 'http://127.0.0.1:4040/api/tunnels'
/** Credential reference holding the ngrok authtoken. It never enters the settings document. */
const AUTHTOKEN_REF = credentialRef('DSH_NGROK_AUTHTOKEN')
/** How long one generate waits for an https address before reporting failure. */
const TUNNEL_TIMEOUT_MS = 20_000
/** Cadence for polling the inspector while a tunnel is starting. */
const POLL_INTERVAL_MS = 500

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `phoneAccess` Remote namespace. */
    phoneAccess: PhoneAccessService
  }
}

interface TunnelJson {
  readonly tunnels?: readonly { readonly public_url?: unknown; readonly proto?: unknown }[]
}

const NGROK_SUFFIXES = ['.ngrok-free.app', '.ngrok.io'] as const
const NGROK_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u

/**
 * Normalize one inspector URL only when it is a bare HTTPS ngrok authority.
 * The launch token is appended later, so paths, credentials, and query strings
 * must never be allowed to come from the local inspector response.
 */
function normalizeNgrokUrl(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  const hostname = url.hostname.toLowerCase()
  const suffix = NGROK_SUFFIXES.find(candidate => hostname.endsWith(candidate))
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '' || suffix === undefined) {
    return undefined
  }
  const label = hostname.slice(0, -suffix.length)
  if (!NGROK_LABEL.test(label)) return undefined
  return `https://${hostname}/`
}

/** Injectable process and clock operations, so tests drive the tunnel without ngrok. */
export interface PhoneAccessInternals {
  /** Launch `ngrok`. Defaults to `node:child_process` `spawn`. */
  spawn?: typeof spawn | undefined
  /** Read the inspector. Defaults to `fetch`. */
  fetch?: typeof fetch | undefined
  /** Delay between inspector polls. */
  sleep?: ((ms: number) => Promise<void>) | undefined
  /** Deadline for one generate, in milliseconds. */
  timeoutMs?: number | undefined
}

/**
 * Read the https address out of one inspector response, or undefined when the
 * body is not the documented tunnel list or lists no https tunnel yet.
 * @param body - the inspector's JSON body.
 * @returns the public https URL.
 */
export function httpsTunnel(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('tunnels' in body)) return undefined
  const tunnels = (body as TunnelJson).tunnels
  if (!Array.isArray(tunnels)) return undefined
  for (const tunnel of tunnels) {
    if (tunnel?.proto === 'https' && typeof tunnel.public_url === 'string') {
      const normalized = normalizeNgrokUrl(tunnel.public_url)
      if (normalized !== undefined) return normalized
    }
  }
  return undefined
}

/** One ngrok child and the address it published. */
interface RunningTunnel {
  /** The ngrok process. */
  readonly child: ChildProcess
  /** Public https URL read from the inspector. */
  readonly publicUrl: string
}

/**
 * Owns the single tunnel of one process and answers the card's Remote calls.
 * A second generate stops the tunnel the first one opened before starting
 * another, so a process never holds two.
 */
export class PhoneAccessService extends Service {
  private running: RunningTunnel | undefined
  private readonly launch: typeof spawn
  private readonly read: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly timeoutMs: number

  /**
   * @param ctx - Host context carrying `webServer`, `connection`, and `credentials`.
   * @param internals - replacements for the process launch and the inspector read.
   */
  constructor(ctx: Context, internals: PhoneAccessInternals = {}) {
    super(ctx, 'phoneAccess')
    this.launch = internals.spawn ?? spawn
    this.read = internals.fetch ?? fetch
    this.sleep = internals.sleep ?? (ms => new Promise((resolve) => { setTimeout(resolve, ms) }))
    this.timeoutMs = internals.timeoutMs ?? TUNNEL_TIMEOUT_MS
    // The tunnel belongs to this process: disposing the fiber closes it.
    ctx.effect(() => () => { void this.stopTunnel() }, 'phone-access: tunnel')
  }

  /**
   * Open one tunnel to this process's Web port and report the scan URL.
   * @returns the card's view: the QR payload and the restart command, or a reason.
   */
  async generate(): Promise<PhoneAccessView> {
    await this.stopTunnel()
    const token = await this.authtoken()
    if (token === undefined) return { error: '还没有配置 ngrok authtoken。' }
    const child = this.start(token, this.ctx.webServer.port)
    const publicUrl = await this.awaitTunnel(child)
    if (publicUrl === undefined) {
      this.kill(child)
      return { error: child.exitCode === null
        ? 'ngrok 没有在限定时间内给出 https 地址。确认本机已安装 ngrok 并且 authtoken 有效。'
        : 'ngrok 进程已退出。确认本机已安装 ngrok 并且 authtoken 有效。' }
    }
    this.running = { child, publicUrl }
    return this.view(publicUrl)
  }

  /**
   * Report the tunnel this process currently holds.
   * @returns the card's view, empty when no tunnel is up.
   */
  current(): PhoneAccessView {
    return this.running === undefined ? {} : this.view(this.running.publicUrl)
  }

  /** Stop the live tunnel and forget it. */
  async stopTunnel(): Promise<void> {
    const running = this.running
    this.running = undefined
    if (running !== undefined) this.kill(running.child)
  }

  /** The view for one live public URL. */
  private view(publicUrl: string): PhoneAccessView {
    const host = new URL(publicUrl).host
    return {
      publicUrl,
      host,
      scanUrl: this.ctx.connection.authenticatedUrl(publicUrl),
      restartCommand: `dsh web --trusted-host ${host}`,
    }
  }

  /** The configured authtoken, or undefined when none is stored. */
  private async authtoken(): Promise<string | undefined> {
    const record = await this.ctx.credentials.resolve(AUTHTOKEN_REF)
    return record?.value
  }

  /** Launch ngrok against the Web port. The token rides the environment, never argv. */
  private start(token: string, port: number): ChildProcess {
    return this.launch('ngrok', ['http', String(port), '--log=stdout'], {
      env: { ...process.env, NGROK_AUTHTOKEN: token },
      stdio: 'ignore',
    })
  }

  /** Poll the inspector until an https tunnel appears, the child exits, or the deadline passes. */
  private async awaitTunnel(child: ChildProcess): Promise<string | undefined> {
    const deadline = Date.now() + this.timeoutMs
    let exited = false
    child.once('exit', () => { exited = true })
    while (!exited && Date.now() < deadline) {
      const found = await this.poll()
      if (found !== undefined) return found
      await this.sleep(POLL_INTERVAL_MS)
    }
    return undefined
  }

  /** Read the inspector once. Any failure reads as "not yet". */
  private async poll(): Promise<string | undefined> {
    try {
      const response = await this.read(NGROK_API)
      if (!response.ok) return undefined
      return httpsTunnel(await response.json() as unknown)
    } catch {
      // The inspector is down until ngrok finishes booting; that is a wait, not a failure.
      return undefined
    }
  }

  /** End one ngrok process. A tunnel that already exited has nothing to signal. */
  private kill(child: ChildProcess): void {
    if (child.exitCode !== null || child.pid === undefined) return
    child.kill()
  }
}

/**
 * Host owner of the `phoneAccess` Remote namespace: the card's three calls.
 * The scan URL is the only secret-bearing field, and it leaves only for the
 * browser that is already signed in.
 */
class PhoneAccessController extends TypertRemoteService {
  /**
   * @param ctx - Host context where {@link PhoneAccessService} is mounted.
   */
  constructor(ctx: Context) {
    super(ctx, 'phoneAccessController', { namespace: 'phoneAccess' })
  }

  /**
   * Open the tunnel and report what the card renders.
   * @returns the scan URL and restart command, or the reason none could be made.
   */
  @Remote
  generate(): Promise<PhoneAccessView> {
    return this.ctx.phoneAccess.generate()
  }

  /**
   * Report the tunnel this process holds.
   * @returns the current view, empty when no tunnel is up.
   */
  @Remote
  current(): PhoneAccessView {
    return this.ctx.phoneAccess.current()
  }

  /** Close the tunnel this process holds. */
  @Remote
  async stop(): Promise<void> {
    await this.ctx.phoneAccess.stopTunnel()
  }
}

/** No configuration: the authtoken lives in the credential store, not here. */
export interface Config {}

/** Empty schema. The row takes no keys. */
export const Config: z<Config> = z.object({})

/** Required services (cordis fiber inject). */
export const inject = ['webServer', 'connection', 'credentials']

/** Plugin name. */
export const name = 'phone-access'

/**
 * Mount the tunnel owner and its Remote namespace.
 * @param ctx - Host plugin context.
 * @param _config - the empty resolved config.
 * @param internals - replacements for the process launch and the inspector read.
 */
export function apply(ctx: Context, _config: Config, internals?: PhoneAccessInternals): void {
  ctx.plugin(PhoneAccessService, internals ?? {})
  ctx.plugin(PhoneAccessController)
}
