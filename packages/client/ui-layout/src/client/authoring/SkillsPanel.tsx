/** Searchable Skill catalog with built-in instructions and editable user entries. */
import { useRef, useState, type ChangeEvent } from 'react'
import {
  Button, Input, Modal, IconSearchOutline16, IconFolderOpenOutline16,
  IconSkillOutline16, IconCodeOutline16, IconEditOutline16, IconNewChatOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SKILL_CATEGORIES, type AuthoringItem, type SkillCategory } from '../../authoring-settings.ts'
import { BUILTIN_SKILLS, userSkillName } from '../../builtin-skills.ts'
import type { LayoutKey } from '../locales.ts'
import { SkillEditor } from './SkillEditor.tsx'
import css from './SkillsPanel.module.css'
import { encodeSkillArchive, MAX_SKILL_ARCHIVE_BYTES, readSkillArchive, SkillArchiveError } from '../../skill-archive.ts'

type Source = 'all' | 'builtin' | 'mine'
interface CatalogSkill {
  name: string
  title: string
  description: string
  body: string
  steps: readonly string[]
  category: SkillCategory
  enabled: boolean
  userInvocable?: boolean
  item?: AuthoringItem
}

/** @param props - Persisted skills and injected authoring actions. @returns Discoverable catalog. */
export function SkillsPanel({ items, writable, loading, save, invoke, t }: {
  items: readonly AuthoringItem[]
  writable: boolean
  loading: boolean
  save: (item: AuthoringItem) => Promise<void>
  invoke: (name: string) => Promise<void>
  t: (key: LayoutKey) => string
}) {
  const [source, setSource] = useState<Source>('all')
  const [category, setCategory] = useState<SkillCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<AuthoringItem | null>(null)
  const [detailName, setDetailName] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<LayoutKey | null>(null)
  const [importPreview, setImportPreview] = useState<{ filename: string; files: string[]; replacing: boolean } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const catalog: CatalogSkill[] = [
    ...BUILTIN_SKILLS.map(skill => ({
      name: skill.name, title: t(skill.title), description: t(skill.description),
      body: t(skill.body), steps: skill.steps.map(t), category: skill.category, enabled: true,
    })),
    ...items.map(item => ({
      name: userSkillName(item.id), title: item.title, description: item.description,
      body: item.body, steps: item.steps, category: item.category ?? 'general', enabled: item.enabled, item,
      userInvocable: item.invocation?.userInvocable ?? true,
    })),
  ]
  const inSource = catalog.filter(skill => source === 'all' || (source === 'builtin' ? !skill.item : !!skill.item))
  const search = query.trim().toLocaleLowerCase()
  const found = inSource.filter(skill => [skill.title, skill.name, skill.description, t(`skill.category.${skill.category}`)].join(' ').toLocaleLowerCase().includes(search))
  const shown = found.filter(skill => category === 'all' || skill.category === category)
  const detail = catalog.find(skill => skill.name === detailName)
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !writable || importing) return
    setImporting(true)
    setImportError(null)
    try {
      if (!/\.zip$/i.test(file.name)) throw new SkillArchiveError('invalidZip')
      if (file.size > MAX_SKILL_ARCHIVE_BYTES) throw new SkillArchiveError('tooLarge')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const skill = readSkillArchive(bytes)
      const id = `imported-${skill.name}`
      const existing = items.find(item => item.id === id)
      setImportPreview({ filename: file.name, files: Object.keys(skill.files), replacing: existing !== undefined })
      setDraft({ id, title: skill.name, description: skill.description, body: skill.body, steps: [],
        enabled: existing?.enabled ?? true, category: skill.category, archive: encodeSkillArchive(bytes),
        invocation: skill.invocation, updatedAt: existing?.updatedAt ?? 0 })
    } catch (error) {
      setImportError(error instanceof SkillArchiveError ? `skill.importError.${error.code}` : 'skill.importError.readFailed')
    } finally { setImporting(false) }
  }
  const saveDraft = async (item: AuthoringItem) => {
    await save(item)
    if (importPreview !== null) { setSource('mine'); setCategory('all'); setQuery('') }
  }
  const useSkill = async (skill: CatalogSkill) => {
    if (opening !== null || !skill.enabled || skill.userInvocable === false) return
    setOpening(skill.name)
    setError(false)
    try { await invoke(skill.name) } catch { setError(true) } finally { setOpening(null) }
  }
  const icon = (skill: CatalogSkill) => skill.category === 'workflow' ? <IconCodeOutline16 size={24} /> : <IconSkillOutline16 size={24} />
  const useButton = (skill: CatalogSkill) => (
    <Button size="sm" variant="outline" icon={<IconNewChatOutline16 />} disabled={!skill.enabled || skill.userInvocable === false || opening !== null} title={skill.userInvocable === false ? t('skill.modelOnly') : undefined} onClick={() => { void useSkill(skill) }}>
      {t(opening === skill.name ? 'skill.opening' : 'skill.use')}
    </Button>
  )
  if (draft !== null) return <SkillEditor initial={draft} importPreview={importPreview} writable={writable} save={saveDraft} close={() => { setDraft(null); setImportPreview(null) }} t={t} />
  return (
    <main className={css.page} aria-busy={loading}>
      <div className={css.inner}>
        <header className={css.header}>
          <div className={css.heading}><IconSkillOutline16 size={28} /><h1>{t('skill.title')}</h1><span className={css.total}>{catalog.length}</span></div>
          <Button variant="primary" icon={<IconFolderOpenOutline16 />} disabled={!writable || importing} onClick={() => { fileInput.current?.click() }}>{t(importing ? 'skill.importing' : 'skill.upload')}</Button>
          <input ref={fileInput} className={css.fileInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" aria-label={t('skill.archiveFile')} disabled={!writable || importing} onChange={(event) => { void upload(event) }} />
        </header>
        <div className={css.toolbar}>
          <div className={css.sources} role="group" aria-label={t('skill.title')}>
            {(['all', 'builtin', 'mine'] as const).map(value => <button type="button" className={css.source} aria-label={t(`skill.${value}`)} aria-pressed={source === value} key={value} onClick={() => { setSource(value) }}>
              {t(`skill.${value}`)}<span>{value === 'all' ? catalog.length : value === 'builtin' ? BUILTIN_SKILLS.length : items.length}</span>
            </button>)}
          </div>
          <Input className={css.search!} icon={<IconSearchOutline16 />} type="search" aria-label={t('skill.search')} placeholder={t('skill.search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
        </div>
        <div className={css.body}>
          <aside className={css.categories} aria-label={t('skill.categories')}>
            <h2>{t('skill.categories')}</h2>
            <div className={css.categoryList}>
              {(['all', ...SKILL_CATEGORIES] as const).map(value => <button type="button" key={value} className={css.category} aria-label={t(`skill.category.${value}`)} aria-pressed={category === value} onClick={() => { setCategory(value) }}>
                <span>{t(`skill.category.${value}`)}</span><span className={css.categoryCount}>{value === 'all' ? found.length : found.filter(skill => skill.category === value).length}</span>
              </button>)}
            </div>
          </aside>
          <section className={css.results} aria-label={t('skill.all')}>
            <div className={css.resultHeader}><h2>{t(`skill.category.${category}`)}</h2><span aria-live="polite">{shown.length} {t('skill.count')}</span></div>
            {error && <p role="alert" className={css.error}>{t('skill.useError')}</p>}
            {importError !== null && <p role="alert" className={css.error}>{t(importError)}</p>}
            {!writable && !loading && <p role="status" className={css.error}>{t('storageUnavailable')}</p>}
            <div className={css.grid}>
              {shown.map(skill => <article className={css.card} key={skill.name}>
                <div className={css.cardTop}><span className={css.skillIcon} data-category={skill.category}>{icon(skill)}</span><span className={css.badge}>{t(skill.item ? 'skill.customBadge' : 'skill.builtinBadge')}</span></div>
                <button type="button" className={css.cardTitle} onClick={() => { setDetailName(skill.name) }}><h3>{skill.title}</h3></button>
                <p className={css.description}>{skill.description || t('skill.category.general')}</p>
                <div className={css.metadata}><span>{t(`skill.category.${skill.category}`)}</span><span className={css.state} data-enabled={skill.enabled}>{t(skill.enabled ? 'skill.ready' : 'skill.disabled')}</span></div>
                <div className={css.cardActions}><Button size="sm" onClick={() => { setDetailName(skill.name) }}>{t('skill.details')}</Button>{useButton(skill)}</div>
              </article>)}
            </div>
            {shown.length === 0 && !loading && <div className={css.empty}>
              <IconSearchOutline16 size={32} /><h3>{t(source === 'mine' && items.length === 0 ? 'skill.noMine' : 'skill.noResults')}</h3>
              <Button onClick={() => { setQuery(''); setCategory('all'); setSource('all') }}>{t('skill.reset')}</Button>
              {source === 'mine' && <Button icon={<IconFolderOpenOutline16 />} disabled={!writable || importing} onClick={() => { fileInput.current?.click() }}>{t('skill.upload')}</Button>}
            </div>}
          </section>
        </div>
      </div>
      {detail && <Modal open title={detail.title} closeLabel={t('skill.close')} onClose={() => { setDetailName(null) }} className={css.detail!} contentClassName={css.detailContent!}
        footer={<div className={css.detailActions}>
          {detail.item && <Button icon={<IconEditOutline16 />} disabled={!writable} onClick={() => { setDraft(detail.item!); setDetailName(null) }}>{t('skill.edit')}</Button>}
          {useButton(detail)}
        </div>}>
        <div className={css.detailMeta}><span className={css.badge}>{t(detail.item ? 'skill.customBadge' : 'skill.builtinBadge')}</span><span>{t(`skill.category.${detail.category}`)}</span></div>
        <p>{detail.description}</p><h3>{t('skill.instructions')}</h3><p className={css.instructions}>{detail.body}</p>
        {detail.steps.length > 0 && <><h3>{t('step')}</h3><ol className={css.detailSteps}>{detail.steps.map((step, index) => <li key={index}>{step}</li>)}</ol></>}
        {error && <p role="alert" className={css.error}>{t('skill.useError')}</p>}
      </Modal>}
    </main>
  )
}
