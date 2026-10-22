/** General Settings row that reveals the Session View switcher. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ViewTabsRow.module.css'

/** Registration-side preference face. */
export interface ViewTabsRowInjected {
  hooks: {
    /** Whether the View switcher renders, bound as useShowViewTabs. */
    showViewTabs: SnapshotStore<boolean>
  }
  /** Show or hide the View switcher. */
  setShowViewTabs: (visible: boolean) => void
}

/** Full Settings-row props. */
export type ViewTabsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<ViewTabsRowInjected>

/**
 * Render the View-switcher visibility switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ViewTabsRow({ useShowViewTabs, setShowViewTabs, t }: ViewTabsRowProps) {
  const visible = useShowViewTabs(value => value)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.viewTabs.title')}</div>
        <div className={css.desc}>{t('settings.viewTabs.description')}</div>
      </div>
      <label className={css.switch}>
        <input
          type="checkbox"
          role="switch"
          checked={visible}
          aria-label={t('settings.viewTabs.title')}
          onChange={(event) => { setShowViewTabs(event.currentTarget.checked) }}
        />
        <span className={css.track} aria-hidden />
      </label>
    </div>
  )
}
