/** Settings page for external software connections. */

import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './PluginsSettingsSection.module.css'
import type {} from './slot-contract.ts'

export type ConnectionsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.integration.item'>

/** Render the extensible external-connections page. */
export function ConnectionsSection({ t, renderSlot }: ConnectionsSectionProps) {
  return (
    <div className={css.section} data-connections-page>
      <h1 className={css.heading}>{t('connectionsTitle')}</h1>
      <p className={css.intro}>{t('connectionsIntro')}</p>
      <div className={css.cards}>
        {renderSlot('settings.integration.item', {})}
      </div>
    </div>
  )
}

export type ConnectionsLocaleKey = PluginsSettingsLocaleKey
