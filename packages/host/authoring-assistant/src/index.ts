/**
 * Conversational authoring assistant: turns a chat exchange into a visual
 * workflow draft or a knowledge-base draft.
 *
 * The service is a Host-only Remote provider. Every turn is one auxiliary
 * `ctx.llm.stream()` request: it carries no `sessionId` and appends no Session
 * event, so drafting never mutates a conversation. The browser owns saving the
 * accepted draft through the existing authoring and knowledge Remotes.
 *
 * @module @deepseek-ai/dsh-host-authoring-assistant
 */

import { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-web'
import schema from '@deepseek-ai/schemastery'
import { acceptKnowledgeDraft, acceptWorkflowDraft, DraftRejected, parseDraftJson, replyText } from './draft.ts'
import {
  AUTHORING_MAX_FETCHED_CHARS,
  AUTHORING_MAX_INPUT_BYTES,
  AUTHORING_MAX_OUTPUT_TOKENS,
  AUTHORING_MAX_SOURCE_CHARS,
  AUTHORING_MAX_SOURCE_URLS,
  composeTurn,
  KNOWLEDGE_SYSTEM_PROMPT,
  renderCurrentDraft,
  renderHistory,
  WORKFLOW_SYSTEM_PROMPT,
} from './prompts.ts'
import { htmlToText } from './text.ts'
import type {
  KnowledgeDraft,
  KnowledgeGenerateRequest,
  KnowledgeGenerateValue,
  WorkflowDraft,
  WorkflowGenerateRequest,
  WorkflowGenerateValue,
} from './types.ts'

export type {
  AuthoringChatTurn,
  AuthoringNodeKind,
  DraftKnowledgeDocument,
  DraftWorkflowEdge,
  DraftWorkflowNode,
  KnowledgeDraft,
  KnowledgeGenerateRequest,
  KnowledgeGenerateValue,
  WorkflowDraft,
  WorkflowGenerateRequest,
  WorkflowGenerateValue,
} from './types.ts'
export { AUTHORING_NODE_KINDS } from './types.ts'
export { acceptKnowledgeDraft, acceptWorkflowDraft, DraftRejected, parseDraftJson, replyText } from './draft.ts'
export { htmlToText } from './text.ts'

/** Plugin config for the authoring assistant. */
export interface Config {
  /** Provider used for drafting. Omitted = the deployment default model. */
  provider?: string
  /** Model used for drafting. Omitted = the deployment default model. */
  model?: string
}

export const Config: schema<Config> = schema.object({
  provider: schema.string(),
  model: schema.string(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    authoringAssistant: AuthoringAssistantService
  }
}

/** One fetched source, already reduced to text and bounded. */
interface FetchedSource {
  url: string
  title?: string
  text: string
}

/** Render fetched material for the model prompt. */
function renderFetched(sources: readonly FetchedSource[]): string {
  if (sources.length === 0) return ''
  const blocks = sources.map(source => `Source: ${source.url}${source.title === undefined ? '' : `\nTitle: ${source.title}`}\n${source.text}`)
  return `Retrieved source material:\n\n${blocks.join('\n\n---\n\n')}`
}

/** Truncate to a whole-number character budget. */
function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n\n(Content truncated.)`
}

/** Remote drafting service exposed as `ctx.authoringAssistant`; every turn is one auxiliary model request and no Session event. */
export class AuthoringAssistantService extends TypertRemoteService {
  static inject = ['llm']

  static Config = Config

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'authoringAssistant')
    this.config = config
  }

  private readonly config: Config

  /**
   * Resolve the model route used for drafting.
   * @returns provider, model, and any configured reasoning effort.
   */
  private selection(): ModelSelection {
    if (this.config.provider !== undefined && this.config.model !== undefined) {
      return { provider: this.config.provider, model: this.config.model }
    }
    const defaults = this.ctx.get('agentDefaultModel') as { currentSelection(): ModelSelection } | undefined
    if (defaults === undefined) {
      throw new RemoteError('gateway/internal', 'no default model is configured; pass provider and model or mount agent-default-model', {})
    }
    const selection = defaults.currentSelection()
    return {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    }
  }

  /**
   * Read one auxiliary model completion.
   * @param system - system prompt for the turn.
   * @param userText - the single user message.
   * @param signal - cancellation for the model call.
   * @returns the raw model text.
   */
  private async complete(system: string, userText: string, signal: AbortSignal): Promise<string> {
    const selection = this.selection()
    if (!this.ctx.llm.listProviders().some(entry => entry.id === selection.provider)) {
      throw new RemoteError(
        'gateway/bad-request',
        `no adapter serves provider "${selection.provider}"; configure a model first`,
        {},
      )
    }
    if (new TextEncoder().encode(userText).byteLength > AUTHORING_MAX_INPUT_BYTES) {
      throw new RemoteError('gateway/bad-request', 'authoring request is too large', {})
    }
    signal.throwIfAborted()
    const options: GenerateOptions = {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      system,
      messages: [createUserMessage({ content: [{ type: 'text', text: userText }], source: { kind: 'user' } })],
      maxTokens: AUTHORING_MAX_OUTPUT_TOKENS,
      signal,
    }
    const assembler = new BlockAssembler()
    try {
      for await (const chunk of this.ctx.llm.stream(options)) {
        signal.throwIfAborted()
        assembler.push(chunk)
      }
      signal.throwIfAborted()
      const finish = assembler.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') {
        throw new Error(finish.failure.message)
      }
      if (finish.kind === 'max-tokens') throw new DraftRejected('model reached the output token limit before finishing the draft')
      if (finish.kind === 'tool-calls') throw new DraftRejected('model requested a tool; drafting must answer with text only')
      const blocks = assembler.blocks()
      if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning')) {
        throw new DraftRejected('model output must contain text only')
      }
      const text = blocks
        .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('')
        .trim()
      if (text === '') {
        // Distinguish an empty completion from a reasoning-only one: the
        // first is a provider or budget problem, the second means the model
        // spent the whole budget thinking before answering.
        const kinds = blocks.map(block => block.type).join(', ') || 'none'
        throw new DraftRejected(`model produced no text (blocks: ${kinds}; finish: ${assembler.finish.kind})`)
      }
      return text
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'authoring request was aborted', {})
      throw new RemoteError(
        'gateway/internal',
        error instanceof Error ? error.message : String(error),
        {},
      )
    }
  }

  /**
   * Draft or revise a visual workflow from one chat turn.
   * @param request - user instruction, prior turns, and the draft being revised.
   * @param signal - cancellation for the model call.
   * @returns the assistant reply and the accepted draft, or a null draft when the model proposed nothing usable.
   */
  @Remote('generateWorkflow')
  async generateWorkflow(request: WorkflowGenerateRequest, signal: AbortSignal): Promise<WorkflowGenerateValue> {
    if (typeof request.message !== 'string' || request.message.trim() === '') {
      throw new RemoteError('gateway/bad-request', 'a message is required', {})
    }
    const userText = composeTurn([
      renderHistory(request.history),
      renderCurrentDraft(request.current),
      `User request: ${request.message.trim()}`,
    ])
    const text = await this.complete(WORKFLOW_SYSTEM_PROMPT, userText, signal)
    const reply = replyText(text)
    try {
      const draft: WorkflowDraft = acceptWorkflowDraft(parseDraftJson(text))
      return { reply: reply === '' ? 'Draft ready.' : reply, draft }
    } catch (error) {
      if (!(error instanceof DraftRejected)) throw error
      // The model answered conversationally without a usable draft: keep the
      // reply so the user can ask again, instead of failing the turn.
      return { reply: reply === '' ? error.message : reply, draft: null }
    }
  }

  /**
   * Draft or revise a knowledge base from one chat turn, optionally fetching
   * user-supplied URLs as source material.
   * @param request - user instruction, prior turns, the draft being revised, and source URLs.
   * @param signal - cancellation for fetching and the model call.
   * @returns the assistant reply, the accepted draft, and per-URL fetch outcomes.
   */
  @Remote('generateKnowledge')
  async generateKnowledge(request: KnowledgeGenerateRequest, signal: AbortSignal): Promise<KnowledgeGenerateValue> {
    if (typeof request.message !== 'string' || request.message.trim() === '') {
      throw new RemoteError('gateway/bad-request', 'a message is required', {})
    }
    const urls = [...new Set((request.urls ?? []).map(url => url.trim()).filter(url => url !== ''))]
    if (urls.length > AUTHORING_MAX_SOURCE_URLS) {
      throw new RemoteError('gateway/bad-request', `at most ${String(AUTHORING_MAX_SOURCE_URLS)} source URLs are allowed`, {})
    }
    const sources: Array<{ url: string; status: 'ok' | 'failed'; detail?: string }> = []
    const fetched: FetchedSource[] = []
    let budget = AUTHORING_MAX_FETCHED_CHARS
    for (const url of urls) {
      if (budget <= 0) {
        sources.push({ url, status: 'failed', detail: 'source budget exhausted' })
        continue
      }
      const outcome = await this.fetchSource(url, signal)
      if (outcome.ok) {
        const text = clip(outcome.text, Math.min(AUTHORING_MAX_SOURCE_CHARS, budget))
        budget -= text.length
        fetched.push({ url, text, ...(outcome.title === undefined ? {} : { title: outcome.title }) })
        sources.push({ url, status: 'ok' })
      } else {
        sources.push({ url, status: 'failed', detail: outcome.detail })
      }
    }
    const userText = composeTurn([
      renderHistory(request.history),
      renderCurrentDraft(request.current),
      renderFetched(fetched),
      `User request: ${request.message.trim()}`,
    ])
    const text = await this.complete(KNOWLEDGE_SYSTEM_PROMPT, userText, signal)
    const reply = replyText(text)
    try {
      const draft: KnowledgeDraft = acceptKnowledgeDraft(parseDraftJson(text))
      return { reply: reply === '' ? 'Draft ready.' : reply, draft, sources }
    } catch (error) {
      if (!(error instanceof DraftRejected)) throw error
      return { reply: reply === '' ? error.message : reply, draft: null, sources }
    }
  }

  /**
   * Fetch one URL and reduce it to readable text.
   * @param url - absolute http(s) URL.
   * @param signal - cancellation for the fetch.
   * @returns the extracted text or a failure detail.
   */
  private async fetchSource(url: string, signal: AbortSignal): Promise<
    { ok: true; text: string; title?: string } | { ok: false; detail: string }
  > {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, detail: 'not an absolute URL' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, detail: 'only http and https URLs are allowed' }
    }
    const web = this.ctx.get('web') as {
      fetch(request: { url: string }, signal?: AbortSignal): Promise<{
        url: string
        statusCode: number
        body: { kind: 'html' | 'text'; content: string }
        truncated: boolean
      }>
    } | undefined
    if (web === undefined) return { ok: false, detail: 'no web fetch provider is mounted' }
    try {
      const result = await web.fetch({ url: parsed.href }, signal)
      if (result.statusCode < 200 || result.statusCode >= 300) {
        return { ok: false, detail: `HTTP ${String(result.statusCode)}` }
      }
      const text = result.body.kind === 'html' ? htmlToText(result.body.content) : result.body.content.trim()
      if (text === '') return { ok: false, detail: 'the page produced no readable text' }
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(result.body.kind === 'html' ? result.body.content : '')?.[1]?.trim()
      return { ok: true, text, ...(title === undefined || title === '' ? {} : { title }) }
    } catch (cause) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'authoring request was aborted', {})
      return { ok: false, detail: cause instanceof Error ? cause.message : String(cause) }
    }
  }
}

export default AuthoringAssistantService
