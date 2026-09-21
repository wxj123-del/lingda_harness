// Web e2e scenario: reasoning is trace-only. A stub adapter holds one
// reasoning block open, so the test can inspect the live transcript before the
// step settles, and then proves the same prose is still reachable in the Token
// trace detail. Both halves are the point: the transcript must never paint
// reasoning, and the trace must keep it.
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, writeComposerDraft, REPO_ROOT } from './support.ts'

const PROVIDER = 'reasoning-trace-only-test'
const MODEL = 'trace-only-model'
const PROMPT = 'Explain event sourcing in one sentence, then stop.'
/** Distinctive enough that a leak into the transcript is unambiguous. */
const REASONING_MARKER = 'TRACE_ONLY_REASONING_MARKER'
const ANSWER = 'TRACE_ONLY_ANSWER_OK'

/**
 * Streams one reasoning block, holds it open on a test-controlled gate, then
 * answers. Holding mid-block is what makes the live-row assertion deterministic
 * instead of a race against the settled render.
 */
class TraceOnlyReasoningAdapter extends LlmAdapter {
  private releaseReasoning!: () => void
  private readonly gate = new Promise<void>((resolve) => { this.releaseReasoning = resolve })
  private readonly held = Promise.withResolvers<void>()

  /** Resolves once the reasoning delta reached the wire. */
  get reasoningHeld(): Promise<void> { return this.held.promise }

  /** Let the held reasoning block end and the answer follow. */
  release(): void { this.releaseReasoning() }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: 0, text: REASONING_MARKER }
    this.held.resolve()
    await this.gate
    options.signal?.throwIfAborted()
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: REASONING_MARKER } }
    yield { type: 'block-start', index: 1, blockType: 'text' }
    yield { type: 'block-end', index: 1, block: { type: 'text', text: ANSWER } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('web e2e: reasoning is trace-only', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const adapter = new TraceOnlyReasoningAdapter()

  beforeAll(async () => {
    // The Token trace panel ships as an optional plugin; mount it explicitly so
    // the trace half of the contract is testable in this profile.
    scaffold = await launchWebScaffold({
      extraOverlayPath: join(REPO_ROOT, 'packages/client/ui-step-insight/cordis.source.patch.yml'),
    })
    scaffold.ctx.effect(
      () => scaffold.ctx.llm.registerAdapter([PROVIDER], adapter),
      'reasoning trace-only adapter',
    )
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: PROVIDER, model: MODEL })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps reasoning out of the transcript while the Token trace still carries it', async () => {
    const transcript = page.locator('[data-conversation-scroll]')
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await writeComposerDraft(page, input, PROMPT)
    await input.press('Enter')

    // Live step: the row exists as a liveness signal and nothing more.
    await adapter.reasoningHeld
    const liveRow = page.locator('[data-variant="think"][data-state="running"]')
    await liveRow.waitFor({ timeout: 30_000 })
    const liveText = await liveRow.textContent() ?? ''
    expect(liveText).toContain('Think')
    expect(liveText).not.toContain(REASONING_MARKER)
    expect(await liveRow.getByRole('button').count()).toBe(0)
    expect(await liveRow.locator('[data-follow-end]').count()).toBe(0)
    expect(await transcript.getByText(REASONING_MARKER, { exact: false }).count()).toBe(0)

    // Settled step: even the liveness row is gone, so no Think state remains.
    adapter.release()
    await settled
    await expect.poll(() => page.locator('[data-variant="think"]').count(), { timeout: 30_000 }).toBe(0)
    expect(await transcript.getByText(REASONING_MARKER, { exact: false }).count()).toBe(0)
    await expect.poll(
      () => transcript.getByText(ANSWER, { exact: false }).count(),
      { timeout: 30_000 },
    ).toBeGreaterThan(0)

    // The same prose is still available where it belongs.
    await page.getByRole('tab', { name: 'Token trace', exact: true }).click()
    const ledger = page.locator('[data-token-ledger]')
    await page.locator('[data-token-request]').first().waitFor({ timeout: 30_000 })
    await ledger.getByRole('tab', { name: 'Output details' }).click()
    await expect.poll(
      () => ledger.getByText(REASONING_MARKER, { exact: false }).count(),
      { timeout: 30_000 },
    ).toBeGreaterThan(0)
    expect(await ledger.getByText('Reasoning', { exact: true }).count()).toBeGreaterThan(0)

    expect(tripwire.pageErrors).toEqual([])
  }, 180_000)
})
