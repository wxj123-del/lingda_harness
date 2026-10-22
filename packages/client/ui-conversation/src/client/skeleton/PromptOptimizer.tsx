import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { MouseEventHandler } from 'react'
import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconCopyOutline16,
  IconEnhanceOutline16,
  IconLoadingOutline16,
  IconRefreshOutline16,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PromptOptimizationMode, SessionOptimizePromptValue } from '@deepseek-ai/dsh-api-session-controller/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ComposerBarProps } from '../contract/slots.ts'
import css from './PromptOptimizer.module.css'

type PromptOptimizerTranslate = ComposerBarProps['t']
type OptimizePrompt = (
  draft: string,
  mode: PromptOptimizationMode,
  signal?: AbortSignal,
) => Promise<RemoteResult<SessionOptimizePromptValue>>

const MODES = ['general', 'code', 'writing', 'analysis'] as const satisfies readonly PromptOptimizationMode[]

function modeLabel(t: PromptOptimizerTranslate, mode: PromptOptimizationMode): string {
  return t(`promptOptimizer.mode.${mode}`)
}

interface PendingRequest {
  readonly id: number
  readonly controller: AbortController
}

export interface PromptOptimizerProps {
  /** Current composer draft used as the source when the panel opens. */
  readonly draft: string
  /** Whether the current input state permits an optimization request. */
  readonly disabled: boolean
  /** Ask the Session's selected model to rewrite the draft. */
  readonly optimizePrompt: OptimizePrompt | undefined
  /** Apply the edited result to the owning composer draft. */
  readonly onApply: (text: string) => void
  /** Keep the editor selection stable when the trigger is pressed. */
  readonly onTriggerMouseDown?: MouseEventHandler<HTMLButtonElement>
  /** Conversation locale seat. */
  readonly t: PromptOptimizerTranslate
}

/** Model-backed prompt rewriting popover mounted in the composer toolbar. */
export function PromptOptimizer({
  draft,
  disabled,
  optimizePrompt,
  onApply,
  onTriggerMouseDown,
  t,
}: PromptOptimizerProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<PromptOptimizationMode>('general')
  const [sourceDraft, setSourceDraft] = useState(draft)
  const [result, setResult] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const requestRef = useRef<PendingRequest | undefined>(undefined)
  const requestId = useRef(0)
  const titleId = useId()

  const abortRequest = useCallback((): void => {
    requestRef.current?.controller.abort()
    requestRef.current = undefined
  }, [])

  const close = useCallback((restoreFocus: boolean): void => {
    abortRequest()
    setOpen(false)
    setStatus('idle')
    setError(null)
    setCopyState('idle')
    if (restoreFocus) triggerRef.current?.focus()
  }, [abortRequest])

  const runOptimization = useCallback(async (draftToOptimize: string, nextMode: PromptOptimizationMode): Promise<void> => {
    if (optimizePrompt === undefined || draftToOptimize.trim() === '') return
    abortRequest()
    const controller = new AbortController()
    const id = requestId.current + 1
    requestId.current = id
    requestRef.current = { id, controller }
    setStatus('loading')
    setError(null)
    setResult('')
    setCopyState('idle')
    try {
      const response = await optimizePrompt(draftToOptimize, nextMode, controller.signal)
      if (requestRef.current?.id !== id || controller.signal.aborted) return
      if (!response.ok) throw new Error(response.error.message || response.error.code)
      const text = response.value.text.trim()
      if (text === '') throw new Error(t('promptOptimizer.emptyResult'))
      setResult(text)
      setStatus('ready')
    } catch (caught: unknown) {
      if (requestRef.current?.id !== id || controller.signal.aborted) return
      setStatus('error')
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (requestRef.current?.id === id) requestRef.current = undefined
    }
  }, [abortRequest, optimizePrompt, t])

  useEffect(() => () => { abortRequest() }, [abortRequest])

  useEffect(() => {
    if (!open) return
    editorRef.current?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return
      close(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [close, open])

  useEffect(() => {
    if (!disabled || !open) return
    close(false)
  }, [close, disabled, open])

  const openPanel = (): void => {
    if (disabled || optimizePrompt === undefined || draft.trim() === '') return
    setSourceDraft(draft)
    setOpen(true)
    void runOptimization(draft, mode)
  }

  const selectMode = (next: PromptOptimizationMode): void => {
    setMode(next)
    if (open) void runOptimization(sourceDraft, next)
  }

  const retry = (): void => {
    void runOptimization(sourceDraft, mode)
  }

  const copyResult = (): void => {
    void writeClipboard(result).then((ok) => {
      setCopyState(ok ? 'copied' : 'failed')
    })
  }

  const canEdit = status === 'ready'
  const canApply = canEdit && result.trim() !== ''
  const copyLabel = copyState === 'copied'
    ? t('promptOptimizer.copied')
    : copyState === 'failed' ? t('promptOptimizer.copyFailed') : t('promptOptimizer.copy')

  return (
    <div ref={rootRef} className={css.root} data-prompt-optimizer>
      <Tooltip label={t('promptOptimizer.trigger')} side="top" delayMs={500}>
        <button
          ref={triggerRef}
          type="button"
          className={css.trigger}
          aria-label={t('promptOptimizer.trigger')}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled || optimizePrompt === undefined || draft.trim() === ''}
          onMouseDown={onTriggerMouseDown}
          onClick={() => {
            if (open) close(false)
            else openPanel()
          }}
        >
          <IconEnhanceOutline16 size={14} />
        </button>
      </Tooltip>
      {open && (
        <div className={css.panel} role="dialog" aria-labelledby={titleId} aria-busy={status === 'loading'}>
          <div className={css.header}>
            <h2 id={titleId} className={css.title}>{t('promptOptimizer.title')}</h2>
            <Tooltip label={t('promptOptimizer.close')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('promptOptimizer.close')}
                onClick={() => { close(true) }}
              >
                <IconCloseOutline16 size={14} />
              </button>
            </Tooltip>
          </div>
          <div className={css.modeRow} role="group" aria-label={t('promptOptimizer.mode')}>
            {MODES.map(candidate => (
              <button
                key={candidate}
                type="button"
                className={css.mode}
                aria-pressed={candidate === mode}
                onClick={() => { selectMode(candidate) }}
              >
                {modeLabel(t, candidate)}
              </button>
            ))}
          </div>
          {status === 'loading' && (
            <div className={css.status} role="status">
              <IconLoadingOutline16 size={14} className={css.spinner} />
              <span>{t('promptOptimizer.loading')}</span>
            </div>
          )}
          {status === 'error' && (
            <div className={css.error} role="alert">
              <span>{error ?? t('promptOptimizer.requestFailed')}</span>
              <button type="button" className={css.retry} onClick={retry}>
                <IconRefreshOutline16 size={14} />
                <span>{t('promptOptimizer.retry')}</span>
              </button>
            </div>
          )}
          <textarea
            ref={editorRef}
            className={css.editor}
            aria-label={t('promptOptimizer.result')}
            aria-busy={status === 'loading'}
            disabled={!canEdit}
            placeholder={status === 'loading' ? t('promptOptimizer.loading') : undefined}
            value={result}
            onChange={(event) => {
              setResult(event.currentTarget.value)
              setCopyState('idle')
            }}
          />
          <div className={css.footer}>
            <Tooltip label={copyLabel} side="top" delayMs={500}>
              <button
                type="button"
                className={css.copy}
                aria-label={copyLabel}
                disabled={!canApply}
                onClick={copyResult}
              >
                {copyState === 'copied' ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
                <span>{copyLabel}</span>
              </button>
            </Tooltip>
            <button
              type="button"
              className={css.apply}
              disabled={!canApply}
              onClick={() => {
                onApply(result)
                close(false)
              }}
            >
              <IconCheckOutline16 size={14} />
              <span>{t('promptOptimizer.apply')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
