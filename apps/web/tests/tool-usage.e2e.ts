/** Recorded Sessions through the real inventory Remote and Tools catalog. */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/tool-usage/usage.expected.md', import.meta.url))

describe('web e2e: Tools catalog and usage', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let logs: ReturnType<typeof watchConsole>
  let fixture: string

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const recording = await readFile(join(REPO_ROOT, 'snapshots/web/navigation-panes/session.v3.jsonl'), 'utf8')
    fixture = recording.trim().split('\n').map((line) => {
      const event = JSON.parse(line) as { type: string; data?: { header: { tools: unknown } } }
      if (event.type === 'request/header' && event.data) event.data.header.tools = [
        { name: 'read', description: 'Read files', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
        { name: 'bash', description: 'Run commands', parameters: { type: 'object' } },
        { name: 'unused_tool', description: 'Unused tool', parameters: { type: 'object' } },
      ]
      return JSON.stringify(event)
    }).join('\n') + '\n'
    for (const id of ['usage-first', 'usage-second']) {
      await seedSession(scaffold, fixture, id, undefined, { createdAt: Date.UTC(2026, 8, 16, 1) })
    }
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    logs = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '工具', exact: true }).click()
    await page.getByRole('article', { name: 'read', exact: true }).waitFor()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('aggregates saved sessions, shows zero counts, filters, refreshes, and fits narrow screens', async () => {
    const usage = page.locator('[data-tool-catalog]')
    const read = usage.locator('[data-tool-name="read"]')
    expect(await read.getByText('已调用 4 次', { exact: true }).isVisible()).toBe(true)
    expect(await usage.getByText('累计调用 6 次', { exact: true }).isVisible()).toBe(true)
    const metrics = usage.getByLabel('工具调用指标', { exact: true })
    expect(await metrics.getByText('6', { exact: true }).isVisible()).toBe(true)
    expect(await metrics.getByText('18', { exact: true }).isVisible()).toBe(true)
    expect(await metrics.getByText('4', { exact: true }).isVisible()).toBe(true)
    expect(await metrics.getByText('22.2%', { exact: true }).isVisible()).toBe(true)
    expect(await read.getByText('33.3%', { exact: true }).isVisible()).toBe(true)
    const raw = await captureStableAria(page, '[data-tool-catalog]', scaffold.workspaceCwd)
    if (webSnapshotMode() === 'refresh') await mkdir(dirname(EXPECTED), { recursive: true })
    await compareOrRefreshGolden(EXPECTED, raw, webSnapshotMode())
    await page.screenshot({ path: '/tmp/dsh-tool-catalog-desktop.png' })
    await read.getByRole('button', { name: '查看详情' }).click()
    const detail = page.getByRole('dialog', { name: 'read', exact: true })
    expect(await detail.getByText('命中次数', { exact: true }).locator('..').locator('dd').textContent()).toBe('2')
    expect(await detail.getByText('携带次数', { exact: true }).locator('..').locator('dd').textContent()).toBe('6')
    expect(await detail.getByText('读取文本文件，并按行号返回内容，便于查看代码、配置和文档。', { exact: true }).isVisible()).toBe(true)
    await detail.getByText('原始说明', { exact: true }).click()
    expect(await detail.getByText('Read files', { exact: true }).isVisible()).toBe(true)
    await detail.getByText('原始说明', { exact: true }).click()
    await detail.getByText('参数定义', { exact: true }).click()
    expect(await detail.locator('pre').textContent()).toContain('"path"')
    await page.screenshot({ path: '/tmp/dsh-tool-catalog-detail.png' })
    await page.keyboard.press('Escape')
    await usage.getByRole('button', { name: '未调用', exact: true }).click()
    expect(await usage.getByRole('article').count()).toBe(1)
    expect(await usage.getByRole('heading', { name: 'unused_tool', exact: true }).isVisible()).toBe(true)
    await usage.getByRole('button', { name: '全部工具', exact: true }).click()
    await usage.getByRole('combobox', { name: '工具排序', exact: true }).selectOption('rate')
    expect(await usage.getByRole('article').first().getAttribute('data-tool-name')).toBe('unused_tool')
    await usage.getByRole('combobox', { name: '工具排序', exact: true }).selectOption('calls')
    await usage.getByRole('searchbox').fill('bash')
    expect(await usage.getByRole('article').count()).toBe(1)
    await usage.getByRole('searchbox').fill('')
    await seedSession(scaffold, fixture, 'usage-third', undefined, { createdAt: Date.UTC(2026, 8, 16, 1) })
    await usage.getByRole('button', { name: '刷新统计' }).click()
    await expect.poll(() => usage.getByText('累计调用 9 次', { exact: true }).isVisible()).toBe(true)
    expect(await metrics.getByText('27', { exact: true }).isVisible()).toBe(true)
    expect(await metrics.getByText('22.2%', { exact: true }).isVisible()).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: '/tmp/dsh-tool-catalog-mobile.png' })
    expect(await usage.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await read.getByRole('button', { name: '查看详情' }).click()
    await page.screenshot({ path: '/tmp/dsh-tool-catalog-detail-mobile.png' })
    expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await detail.getByRole('button', { name: '关闭详情' }).click()
    await page.getByRole('button', { name: '插件', exact: true }).click()
    expect(await page.getByRole('tab', { name: '工具使用统计', exact: true }).count()).toBe(0)
    expect(logs.pageErrors).toEqual([])
  })

  it('creates and edits a custom tool through the card catalog', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: '工具', exact: true }).click()
    await page.getByRole('button', { name: '新建工具' }).click()
    await page.getByLabel('名称', { exact: true }).fill('标题助手')
    await page.getByLabel('描述', { exact: true }).fill('撰写文章标题')
    await page.getByLabel('说明', { exact: true }).fill('输出三个简洁标题')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('button', { name: '自建工具', exact: true }).click()
    const card = page.getByRole('article', { name: '标题助手', exact: true })
    await card.waitFor()
    expect(await card.getByText('已调用 0 次', { exact: true }).isVisible()).toBe(true)
    await card.getByRole('button', { name: '查看详情' }).click()
    await page.getByRole('button', { name: '编辑工具' }).click()
    await page.getByLabel('名称', { exact: true }).fill('新的标题助手')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: '工具', exact: true }).click()
    await page.getByRole('article', { name: '新的标题助手', exact: true }).waitFor()
    expect(await page.getByRole('article', { name: '标题助手', exact: true }).count()).toBe(0)
    expect(logs.pageErrors).toEqual([])
  })
})
