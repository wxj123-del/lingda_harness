import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/** Credential reference holding the ngrok authtoken. */
export const PHONE_ACCESS_TOKEN_REF = 'DSH_NGROK_AUTHTOKEN'

/** Settings the card borrows a scope from. The token itself is not among them. */
interface PhoneAccessSettings {}

/** The tunnel the Host currently holds, as the card renders it. */
export interface PhoneAccessTunnel {
  /** QR payload: the public root URL carrying this process's launch token. */
  readonly scanUrl: string
  /** Command that admits the tunnel's hostname after a restart. */
  readonly restartCommand: string
}

/** Snapshot injected into the phone access card. */
export interface PhoneAccessCardState extends CardShell {
  /** Staged authtoken text. */
  token: CardFieldState
  /** Whether the Host reports a stored authtoken. */
  tokenConfigured: boolean
  /** Whether the credential store accepts a write for the reference. */
  tokenWritable: boolean
  /** Whether a generate is crossing the wire. */
  generating: boolean
  /** The live tunnel, when one is up. */
  tunnel: PhoneAccessTunnel | undefined
  /** Why the last generate produced nothing. */
  failure: string | undefined
}

/** Actions and snapshot state injected into the phone access card. */
export interface PhoneAccessCardFace extends CardActions {
  /** Open a tunnel and publish what the card renders. */
  generate: () => void
  hooks: { phoneAccessCard: SnapshotStore<PhoneAccessCardState> }
}

/**
 * Bridges the ngrok authtoken credential and the `phoneAccess` Remote.
 *
 * The card has no settings section of its own: the form is bound to an empty
 * scope purely so the authtoken stages and saves like every other secret, and
 * the tunnel is asked for directly because it is process state, not a setting.
 */
export class PhoneAccessCardController {
  private readonly form: CardForm<PhoneAccessSettings>
  private readonly store: SnapshotStore<PhoneAccessCardState>
  private configured = false
  private writable = true
  private generating = false
  private tunnel: PhoneAccessTunnel | undefined
  private failure: string | undefined

  /**
   * @param scope - a settings scope standing in for the form. Its namespace is
   *   never written; the authtoken goes through the credentials domain.
   * @param ctx - the card plugin's context, whose `remote` carries both
   *   `credentials` and `phoneAccess`.
   */
  constructor(
    scope: SettingsScope<PhoneAccessSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.form = new CardForm(
      scope,
      [],
      [{ field: 'token', write: text => this.writeToken(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    void this.start()
  }

  private projection(): PhoneAccessCardState {
    return {
      ...this.form.shell(),
      // The card renders whenever the credentials domain answered, whether or
      // not the borrowed scope's namespace is served.
      available: true,
      token: this.form.field('token'),
      tokenConfigured: this.configured,
      tokenWritable: this.writable,
      generating: this.generating,
      tunnel: this.tunnel,
      failure: this.failure,
    }
  }

  /**
   * Build the slot injection consumed by the phone access card.
   * @returns the snapshot hook, the form actions, and the generate action.
   */
  inject(): PhoneAccessCardFace {
    return {
      hooks: { phoneAccessCard: this.store },
      ...this.form.actions(),
      generate: () => { void this.generate() },
    }
  }

  /**
   * Refresh the configured state when the Host reports the authtoken changed.
   * @param ref - credential reference reported by the Host.
   */
  refreshCredential(ref: string): void {
    if (ref === PHONE_ACCESS_TOKEN_REF) void this.readToken()
  }

  /** Read the stored authtoken and the tunnel this process already holds. */
  private async start(): Promise<void> {
    await this.readToken()
    await this.readCurrent()
  }

  private async readToken(): Promise<void> {
    const response = await this.ctx.remote.credentials.describe([PHONE_ACCESS_TOKEN_REF])
    if (!response.ok) return
    const info = response.value[PHONE_ACCESS_TOKEN_REF]
    this.configured = info?.configured ?? false
    this.writable = info?.writable ?? true
    this.store.set(this.projection())
  }

  private async readCurrent(): Promise<void> {
    const phoneAccess = this.ctx.get('remote.phoneAccess') as ClientContext['remote']['phoneAccess'] | undefined
    if (phoneAccess === undefined) return
    const response = await phoneAccess.current()
    if (!response.ok || response.value.scanUrl === undefined || response.value.restartCommand === undefined) return
    this.tunnel = { scanUrl: response.value.scanUrl, restartCommand: response.value.restartCommand }
    this.store.set(this.projection())
  }

  private async writeToken(value: string): Promise<boolean> {
    await this.ctx.remote.credentials.set(PHONE_ACCESS_TOKEN_REF, value)
    await this.readToken()
    return this.configured
  }

  private async generate(): Promise<void> {
    if (!this.configured || this.generating) return
    this.generating = true
    this.failure = undefined
    this.store.set(this.projection())
    try {
      const phoneAccess = this.ctx.get('remote.phoneAccess') as ClientContext['remote']['phoneAccess'] | undefined
      if (phoneAccess === undefined) return
      const response = await phoneAccess.generate()
      if (!response.ok) {
        this.failure = response.error.message
      } else if (response.value.scanUrl !== undefined && response.value.restartCommand !== undefined) {
        this.tunnel = { scanUrl: response.value.scanUrl, restartCommand: response.value.restartCommand }
        this.failure = undefined
      } else {
        this.tunnel = undefined
        this.failure = response.value.error
      }
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error)
    } finally {
      this.generating = false
      this.store.set(this.projection())
    }
  }
}
