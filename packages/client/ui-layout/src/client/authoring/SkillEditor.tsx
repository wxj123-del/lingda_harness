/** Skill authoring form; writes commit before returning to the catalog. */
import { useState } from 'react'
import { Button, Input, Switch, IconChevronLeftOutline14, IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SKILL_CATEGORIES, type AuthoringItem, type SkillCategory } from '../../authoring-settings.ts'
import type { LayoutKey } from '../locales.ts'
import { StepsEditor } from './StepsEditor.tsx'
import form from './AuthoringPanel.module.css'
import css from './SkillsPanel.module.css'

/** @param props - Initial draft, persistence and navigation callbacks. @returns Skill form. */
export function SkillEditor({ initial, importPreview, writable, save, close, t }: {
  initial: AuthoringItem
  importPreview: { filename: string; files: string[]; replacing: boolean } | null
  writable: boolean
  save: (item: AuthoringItem) => Promise<void>
  close: () => void
  t: (key: LayoutKey) => string
}) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft)
  const back = () => { if (!dirty || window.confirm(t('skill.discard'))) close() }
  const submit = async () => {
    if (!writable || saving || !draft.title.trim()) return
    setSaving(true)
    setError(false)
    try {
      await save({ ...draft, title: draft.title.trim(), updatedAt: Date.now() })
      close()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }
  return (
    <main className={css.page}>
      <div className={css.editorWrap}>
        <Button icon={<IconChevronLeftOutline14 />} disabled={saving} onClick={back}>{t('skill.back')}</Button>
        <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <header className={css.editorHeading}>
            <h1>{t(importPreview === null ? 'skill.edit' : 'skill.importTitle')}</h1>
            <Switch checked={draft.enabled} disabled={saving} label={t('skill.enable')} onChange={(enabled) => { setDraft({ ...draft, enabled }) }} />
          </header>
          {importPreview !== null && <div className={css.importSummary}>
            <p className={css.importSuccess}>{t('skill.recognized')}</p>
            <p>{importPreview.filename} · {importPreview.files.length} {t('skill.packageFiles')}</p>
            {importPreview.replacing && <p role="status" className={form.warning}>{t('skill.replaceNotice')}</p>}
            <details><summary>{t('skill.packageContents')}</summary><ul>{importPreview.files.map(path => <li key={path}>{path}</li>)}</ul></details>
          </div>}
          <fieldset className={css.fields} disabled={saving}>
            <label className={form.field}><span className={form.label}>{t('name')}</span><Input autoFocus required value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }) }} /></label>
            <label className={form.field}><span className={form.label}>{t('skill.description')}</span><Input value={draft.description} placeholder={t('skill.descriptionPlaceholder')} onChange={(event) => { setDraft({ ...draft, description: event.target.value }) }} /></label>
            <label className={form.field}><span className={form.label}>{t('skill.category')}</span>
              <select aria-label={t('skill.category')} className={form.input} value={draft.category ?? 'general'} onChange={(event) => { setDraft({ ...draft, category: event.target.value as SkillCategory }) }}>
                {SKILL_CATEGORIES.map(category => <option key={category} value={category}>{t(`skill.category.${category}`)}</option>)}
              </select>
            </label>
            <label className={form.field}><span className={form.label}>{t('skill.instructions')}</span><textarea aria-label={t('skill.instructions')} className={form.textarea} value={draft.body} onChange={(event) => { setDraft({ ...draft, body: event.target.value }) }} /></label>
            <StepsEditor item={draft} setItem={setDraft} t={t} />
          </fieldset>
          <div className={css.editorActions}>
            <Button type="submit" variant="primary" icon={<IconCheckOutline16 />} disabled={!writable || saving || !draft.title.trim()}>{t(saving ? 'skill.saving' : importPreview === null ? 'save' : importPreview.replacing ? 'skill.replace' : 'skill.import')}</Button>
            {!writable && <span className={form.warning}>{t('storageUnavailable')}</span>}
            {error && <span role="alert" className={form.warning}>{t('skill.saveError')}</span>}
          </div>
        </form>
      </div>
    </main>
  )
}
