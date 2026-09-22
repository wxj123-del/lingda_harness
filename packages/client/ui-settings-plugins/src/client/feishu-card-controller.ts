import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  booleanField, CardForm, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/** Settings namespace owned by the Feishu bot Host plugin. */
export const FEISHU_NS = 'webhook-feishu'

const DEFAULT_APP_ID_REF = 'DSH_FEISHU_APP_ID'
const DEFAULT_APP_SECRET_REF = 'DSH_FEISHU_APP_SECRET'

/** The non-secret settings the Feishu card lets users edit. */
export interface FeishuSettings {
  appIdEnv?: string
  appSecretEnv?: string
  workspacePath?: string
  agentPreset?: string
  permissionPreset?: string
  requireMention?: boolean
}

interface CredentialState {
  ref: string
  configured: boolean
  writable: boolean
}

/** Snapshot and actions injected into the Feishu card slot. */
export interface FeishuCardState extends CardShell {
  workspacePath: CardFieldState
  agentPreset: CardFieldState
  permissionPreset: CardFieldState
  requireMention: CardFieldState
  appId: CardFieldState
  appSecret: CardFieldState
  appIdConfigured: boolean
  appIdWritable: boolean
  appSecretConfigured: boolean
  appSecretWritable: boolean
}

/** Actions and snapshot state injected into the Feishu card. */
export interface FeishuCardFace extends CardActions {
  hooks: { feishuCard: SnapshotStore<FeishuCardState> }
}

/** Bridges the Feishu settings section and its two write-only credentials. */
export class FeishuCardController {
  private readonly form: CardForm<FeishuSettings>
  private readonly store: SnapshotStore<FeishuCardState>
  private appId: CredentialState = { ref: '', configured: false, writable: true }
  private appSecret: CredentialState = { ref: '', configured: false, writable: true }

  constructor(
    private readonly scope: SettingsScope<FeishuSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.form = new CardForm(
      scope,
      [textField('workspacePath'), textField('agentPreset'), textField('permissionPreset'), booleanField('requireMention')],
      [
        { field: 'appId', write: text => this.writeCredential('appId', text) },
        { field: 'appSecret', write: text => this.writeCredential('appSecret', text) },
      ],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredentials() })
    void this.readCredentials()
  }

  private projection(): FeishuCardState {
    return {
      ...this.form.shell(),
      workspacePath: this.form.field('workspacePath'),
      agentPreset: this.form.field('agentPreset'),
      permissionPreset: this.form.field('permissionPreset'),
      requireMention: this.form.field('requireMention'),
      appId: this.form.field('appId'),
      appSecret: this.form.field('appSecret'),
      appIdConfigured: this.appId.configured,
      appIdWritable: this.appId.writable,
      appSecretConfigured: this.appSecret.configured,
      appSecretWritable: this.appSecret.writable,
    }
  }

  /**
   * Build the slot injection consumed by the Feishu card.
   * @returns the snapshot hook and form actions.
   */
  inject(): FeishuCardFace {
    return { hooks: { feishuCard: this.store }, ...this.form.actions() }
  }

  /**
   * Refresh credential status when the Host reports a watched reference update.
   * @param ref - credential reference reported by the Host.
   */
  refreshCredential(ref: string): void {
    if (ref === this.appId.ref || ref === this.appSecret.ref) void this.readCredentials()
  }

  private refs(snapshot: SettingsScopeSnapshot<FeishuSettings>): { appId: string; appSecret: string } {
    return {
      appId: snapshot.value?.appIdEnv || DEFAULT_APP_ID_REF,
      appSecret: snapshot.value?.appSecretEnv || DEFAULT_APP_SECRET_REF,
    }
  }

  private async readCredentials(): Promise<void> {
    const refs = this.refs(this.scope.getSnapshot())
    this.appId = { ref: refs.appId, configured: false, writable: true }
    this.appSecret = { ref: refs.appSecret, configured: false, writable: true }
    this.store.set(this.projection())
    const response = await this.ctx.remote.credentials.describe([...new Set([refs.appId, refs.appSecret])])
    if (!response.ok) return
    const current = this.refs(this.scope.getSnapshot())
    if (current.appId !== refs.appId || current.appSecret !== refs.appSecret) return
    const appId = response.value[refs.appId]
    const appSecret = response.value[refs.appSecret]
    this.appId = { ref: refs.appId, configured: appId?.configured ?? false, writable: appId?.writable ?? true }
    this.appSecret = { ref: refs.appSecret, configured: appSecret?.configured ?? false, writable: appSecret?.writable ?? true }
    this.store.set(this.projection())
  }

  private async writeCredential(kind: 'appId' | 'appSecret', value: string): Promise<boolean> {
    const refs = this.refs(this.scope.getSnapshot())
    await this.ctx.remote.credentials.set(kind === 'appId' ? refs.appId : refs.appSecret, value)
    await this.readCredentials()
    return kind === 'appId' ? this.appId.configured : this.appSecret.configured
  }
}
