import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { PhoneAccessCardFace } from './phone-access-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './fields.module.css'

export type PhoneAccessCardProps =
  PropsRuntime<'settings.integration.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<PhoneAccessCardFace>

/** Render a QR image for one payload, or nothing while it is being drawn. */
function QrImage({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<string | undefined>(undefined)
  useEffect(() => {
    let current = true
    void QRCode.toDataURL(value, { margin: 1, width: 220 }).then((url) => {
      if (current) setSrc(url)
    }, () => { /* an undrawable payload shows the warning without an image */ })
    return () => { current = false }
  }, [value])
  return src === undefined ? null : <img className={css.qr} src={src} alt={label} />
}

/** The phone access card: an authtoken, a generate button, and the resulting code. */
export function PhoneAccessCard(props: PhoneAccessCardProps) {
  const { t } = props
  const state = props.usePhoneAccessCard(snapshot => snapshot)
  const [copied, setCopied] = useState(false)
  const tunnel = state.tunnel
  return (
    <PluginCard
      t={t}
      titleKey="phoneAccessTitle"
      descriptionKey="phoneAccessDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="plugin-config-phone-access-token"
        label={t('phoneAccessToken')}
        hint={t('phoneAccessTokenHint')}
        disabled={!state.tokenWritable}
        text={state.token.text}
        configured={state.tokenConfigured}
        stateLabel={state.tokenConfigured ? t('phoneAccessCredentialSet') : t('phoneAccessCredentialUnset')}
        onEdit={(text) => { props.edit('token', text) }}
      />
      <div className={css.field}>
        <button
          type="button"
          className={css.action}
          disabled={!state.tokenConfigured || state.generating}
          onClick={props.generate}
        >
          {t(state.generating ? 'phoneAccessGenerating' : 'phoneAccessGenerate')}
        </button>
        {state.failure !== undefined ? <p className={css.invalid} role="status">{state.failure}</p> : null}
      </div>
      {tunnel !== undefined
        ? (
          <div className={css.field}>
            <QrImage value={tunnel.scanUrl} label={t('phoneAccessTitle')} />
            <p className={css.invalid} role="status">{t('phoneAccessWarning')}</p>
            <p className={css.hint}>{t('phoneAccessRestart')}</p>
            <div className={css.command}>
              <code>{tunnel.restartCommand}</code>
              <button
                type="button"
                className={css.reset}
                onClick={() => {
                  void navigator.clipboard.writeText(tunnel.restartCommand).then(() => { setCopied(true) })
                }}
              >
                {t(copied ? 'phoneAccessCopied' : 'phoneAccessCopy')}
              </button>
            </div>
          </div>
        )
        : null}
    </PluginCard>
  )
}
