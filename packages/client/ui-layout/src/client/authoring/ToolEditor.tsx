/** User-authored tool form with commit-before-close persistence. */
import { useState } from 'react'
import { Button, IconChevronLeftOutline14, IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthoringItem } from '../../authoring-settings.ts'
import type { LayoutKey } from '../locales.ts'
import { StepsEditor } from './StepsEditor.tsx'
import css from './SkillsPanel.module.css'
import form from './AuthoringPanel.module.css'

/** @param props - Draft, persistence and return action. @returns Tool editing form. */
export function ToolEditor({ initial, writable, save, close, t }: {
  initial: AuthoringItem
  writable: boolean
  save: (item: AuthoringItem) => Promise<void>
  close: () => void
  t: (key: LayoutKey) => string
}) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const back = () => {
    if (JSON.stringify(initial) === JSON.stringify(draft) || window.confirm(t('tool.discard'))) close()
  }
  const submit = async () => {
    if (!writable || saving || !draft.title.trim()) return
    setSaving(true)
    setError(false)
    try {
      await save({ ...draft, title: draft.title.trim(), updatedAt: Date.now() })
      close()
    } catch { setError(true) } finally { setSaving(false) }
  }
  return <main className={css.page}>
    <div className={css.editorWrap}>
      <Button icon={<IconChevronLeftOutline14 />} disabled={saving} onClick={back}>{t('tool.back')}</Button>
      <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <header className={css.editorHeading}><h1>{t('tool.edit')}</h1></header>
        <fieldset className={css.fields} disabled={!writable || saving}>
          <label className={form.field}><span>{t('name')}</span><input className={form.input} required value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }) }} /></label>
          <label className={form.field}><span>{t('description')}</span><input className={form.input} value={draft.description} onChange={(event) => { setDraft({ ...draft, description: event.target.value }) }} /></label>
          <label className={form.toggle}><input type="checkbox" checked={draft.enabled} onChange={(event) => { setDraft({ ...draft, enabled: event.target.checked }) }} />{t('tool.enable')}</label>
          <label className={form.field}><span>{t('instructions')}</span><textarea className={form.textarea} value={draft.body} onChange={(event) => { setDraft({ ...draft, body: event.target.value }) }} /></label>
          <StepsEditor item={draft} setItem={setDraft} t={t} />
        </fieldset>
        {error && <p role="alert" className={css.error}>{t('tool.saveError')}</p>}
        {!writable && <p role="status" className={css.error}>{t('storageUnavailable')}</p>}
        <div className={css.editorActions}><Button type="submit" variant="primary" icon={<IconCheckOutline16 />} disabled={!writable || saving || !draft.title.trim()}>{t(saving ? 'tool.saving' : 'save')}</Button></div>
      </form>
    </div>
  </main>
}
