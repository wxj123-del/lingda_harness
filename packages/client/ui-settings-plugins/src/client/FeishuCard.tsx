import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import { SecretField, ValueField } from './fields.tsx'
import type { FeishuCardFace } from './feishu-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './fields.module.css'

export type FeishuCardProps =
  PropsRuntime<'settings.integration.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<FeishuCardFace>

export function FeishuCard(props: FeishuCardProps) {
  const { t } = props
  const state = props.useFeishuCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="feishuTitle"
      descriptionKey="feishuDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="plugin-config-feishu-app-id"
        label={t('feishuAppId')}
        hint={t('feishuAppIdHint')}
        disabled={!state.appIdWritable}
        text={state.appId.text}
        configured={state.appIdConfigured}
        stateLabel={state.appIdConfigured ? t('feishuCredentialSet') : t('feishuCredentialUnset')}
        onEdit={(text) => { props.edit('appId', text) }}
      />
      <SecretField
        id="plugin-config-feishu-app-secret"
        label={t('feishuAppSecret')}
        hint={t('feishuAppSecretHint')}
        disabled={!state.appSecretWritable}
        text={state.appSecret.text}
        configured={state.appSecretConfigured}
        stateLabel={state.appSecretConfigured ? t('feishuCredentialSet') : t('feishuCredentialUnset')}
        onEdit={(text) => { props.edit('appSecret', text) }}
      />
      <ValueField
        id="plugin-config-feishu-workspace"
        label={t('feishuWorkspacePath')}
        hint={t('feishuWorkspacePathHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.workspacePath}
        onEdit={(text) => { props.edit('workspacePath', text) }}
        onReset={() => { props.resetField('workspacePath') }}
      />
      <ValueField
        id="plugin-config-feishu-agent-preset"
        label={t('feishuAgentPreset')}
        hint={t('feishuAgentPresetHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.agentPreset}
        onEdit={(text) => { props.edit('agentPreset', text) }}
        onReset={() => { props.resetField('agentPreset') }}
      />
      <ValueField
        id="plugin-config-feishu-permission-preset"
        label={t('feishuPermissionPreset')}
        hint={t('feishuPermissionPresetHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.permissionPreset}
        onEdit={(text) => { props.edit('permissionPreset', text) }}
        onReset={() => { props.resetField('permissionPreset') }}
      />
      <div className={css.field}>
        <label>
          <input
            type="checkbox"
            checked={state.requireMention.text === 'true'}
            disabled={disabled}
            onChange={(event) => { props.edit('requireMention', String(event.target.checked)) }}
          />
          {t('feishuRequireMention')}
        </label>
        <p className={css.hint}>{t('feishuRequireMentionHint')}</p>
      </div>
    </PluginCard>
  )
}
