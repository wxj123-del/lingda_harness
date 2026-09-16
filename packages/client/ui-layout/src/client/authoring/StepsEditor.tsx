import { useState } from 'react'
import { Button, IconPlusOutline16, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthoringItem } from '../../authoring-settings.ts'
import type { zh } from '../locales.ts'
import css from './AuthoringPanel.module.css'

/** Ordered instructions shared by the Skill and workflow editors. */
export function StepsEditor({ item, setItem, t }: {
  item: AuthoringItem
  setItem: (item: AuthoringItem) => void
  t: (key: keyof typeof zh) => string
}) {
  const [newStep, setNewStep] = useState('')
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= item.steps.length) return
    const steps = [...item.steps]
    const [step] = steps.splice(index, 1)
    if (step === undefined) return
    steps.splice(target, 0, step)
    setItem({ ...item, steps })
  }
  return (
    <div className={css.field}>
      <div className={css.stepHeader}><span className={css.label}>{t('step')}</span><Button size="sm" icon={<IconPlusOutline16 />} onClick={() => { if (newStep.trim()) { setItem({ ...item, steps: [...item.steps, newStep.trim()] }); setNewStep('') } }}>{t('addStep')}</Button></div>
      <div className={css.steps}>
        {item.steps.map((step, index) => (
          <div className={css.stepRow} key={index}>
            <span className={css.stepNumber}>{index + 1}</span>
            <input className={`${css.input} ${css.stepInput}`} value={step} aria-label={`${t('step')} ${index + 1}`} onChange={(e) => { const steps = [...item.steps]; steps[index] = e.target.value; setItem({ ...item, steps }) }} />
            <div className={css.stepActions}>
              <button type="button" className={css.iconButton} title={t('moveUp')} onClick={() => { move(index, -1) }}>↑</button>
              <button type="button" className={css.iconButton} title={t('moveDown')} onClick={() => { move(index, 1) }}>↓</button>
              <button type="button" className={css.iconButton} title={t('remove')} onClick={() => { setItem({ ...item, steps: item.steps.filter((_, i) => i !== index) }) }}><IconCloseOutline16 size={14} /></button>
            </div>
          </div>
        ))}
        <input className={css.input} value={newStep} placeholder={`${t('step')}...`} onChange={(e) => { setNewStep(e.target.value) }} onKeyDown={(e) => { if (e.key === 'Enter' && newStep.trim()) { e.preventDefault(); setItem({ ...item, steps: [...item.steps, newStep.trim()] }); setNewStep('') } }} />
      </div>
    </div>
  )
}
