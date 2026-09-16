/** Optional Token ledger against the real Loader, browser and recorded Session history. */
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/step-insight/ledger.expected.md', import.meta.url))

describe('web e2e: optional Token trace plugin', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let logs: ReturnType<typeof watchConsole>
  const errors: string[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: join(REPO_ROOT, 'packages/client/ui-step-insight/cordis.source.patch.yml'),
    })
    const recorded = await readFile(join(REPO_ROOT, 'snapshots/web/navigation-panes/session.v3.jsonl'), 'utf8')
    // The recorded schema placeholder needs concrete descriptions for relevance inspection.
    const fixture = recorded.trim().split('\n').map((line) => {
      const event = JSON.parse(line) as { type: string; data?: { header: { tools: unknown } } }
      if (event.type === 'request/header' && event.data) event.data.header.tools = [
        { name: 'image_generate', description: 'Generate pictures', parameters: { type: 'object' } },
        { name: 'read', description: 'Read file contents', parameters: { type: 'object' } },
        { name: 'bash', description: 'Run a bash command', parameters: { type: 'object' } },
      ]
      return JSON.stringify(event)
    }).join('\n') + '\n'
    await seedSession(scaffold, fixture, 'token-trace-e2e')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    logs = watchConsole(page)
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Search sessions' }).click()
    await page.getByPlaceholder('Search sessions', { exact: false }).fill('WATERFALL')
    const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
    await result.waitFor({ state: 'visible', timeout: 30_000 })
    await result.click()
    await page.getByRole('tab', { name: 'Token trace', exact: true }).click()
    await page.locator('[data-token-request]').first().waitFor()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('replaces Trajectory with request accounting, sources, export and responsive inspection', async () => {
    expect(page.url()).toContain('127.0.0.1')
    expect(await page.title()).not.toBe('')
    expect(await page.getByRole('tab', { name: 'Trajectory', exact: true }).count()).toBe(0)
    expect(await page.getByRole('tab', { name: 'Chat', exact: true }).count()).toBe(1)
    const ledger = page.locator('[data-token-ledger]')
    const count = await page.locator('[data-token-request]').count()
    expect(count).toBeGreaterThan(1)
    const raw = await captureStableAria(page, '[data-token-ledger]', scaffold.workspaceCwd)
    if (webSnapshotMode() === 'refresh') await mkdir(dirname(EXPECTED), { recursive: true })
    await compareOrRefreshGolden(EXPECTED, raw, webSnapshotMode())

    await ledger.getByRole('searchbox').fill('bash')
    await expect.poll(() => page.locator('[data-token-request]').count()).toBe(1)
    await page.locator('[data-token-request] button').click()
    await ledger.getByRole('tab', { name: /Tool calls/ }).click()
    expect(await ledger.getByText('NAVIGATION_OK', { exact: false }).count()).toBeGreaterThan(0)
    await ledger.getByRole('tab', { name: 'Source records' }).click()
    expect(await ledger.locator('summary').filter({ hasText: 'tool/result' }).count()).toBeGreaterThan(0)
    await ledger.getByRole('searchbox').fill('')
    await ledger.getByRole('tab', { name: 'Input sources' }).click()
    const similarities = ledger.getByRole('region', { name: 'Tool / conversation similarity' })
    expect(await similarities.getByRole('meter').count()).toBe(3)
    expect(await similarities.getByText('Called in this step', { exact: true }).count()).toBe(2)
    await similarities.getByRole('combobox', { name: 'Tool order', exact: true }).selectOption('similarity')
    const scores = await similarities.getByRole('meter').evaluateAll(elements => elements.map(element => Number(element.getAttribute('value'))))
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(scores[0]).toBeGreaterThan(0)
    await similarities.locator('[data-tool-schema="read"] summary').click()
    expect(await similarities.locator('[data-tool-schema="read"]').getByText('Matched terms', { exact: true }).isVisible()).toBe(true)
    await similarities.getByText('Reference text and scoring basis', { exact: false }).click()
    expect(await similarities.getByText('NavScenario:', { exact: false }).isVisible()).toBe(true)
    await similarities.getByRole('combobox', { name: 'Conversation scope', exact: true }).selectOption('all')
    await similarities.locator('[data-tool-schema="read"] summary').click()
    await similarities.getByText('Reference text and scoring basis', { exact: false }).click()
    await similarities.scrollIntoViewIfNeeded()
    await page.screenshot({ path: '/tmp/dsh-token-ledger-desktop.png' })

    const downloadEvent = page.waitForEvent('download')
    await ledger.getByRole('button', { name: 'Export loaded records' }).click()
    const downloaded = await downloadEvent
    const report = JSON.parse(await readFile((await downloaded.path()), 'utf8')) as { format: string; rows: unknown[] }
    expect(report.format).toBe('dsh-token-ledger-v1')
    expect(report.rows).toHaveLength(count)

    await page.setViewportSize({ width: 390, height: 844 })
    await similarities.scrollIntoViewIfNeeded()
    await page.screenshot({ path: '/tmp/dsh-token-ledger-mobile.png' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await similarities.locator('[data-tool-schema] summary').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true)
    expect(await ledger.locator('[role="tabpanel"]').isVisible()).toBe(true)
    expect(logs.pageErrors).toEqual([])
    expect(errors).toEqual([])
  })
})
