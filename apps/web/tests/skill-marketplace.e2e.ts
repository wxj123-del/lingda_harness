/** Keyless real-host coverage of Skill discovery, persisted authoring and composer handoff. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { strToU8, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-skill'
import { acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, watchConsole } from './scaffold.ts'
import { connectFreshWorkspaceZh } from './support.ts'

it('discovers built-in skills, imports a Skill bundle and prepares explicit invocation', async () => {
  const scaffold = await launchWebScaffold({})
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const tripwire = watchConsole(page)
  try {
    await page.goto(scaffold.authenticatedUrl)
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    await page.getByRole('button', { name: 'Skill', exact: true }).click()
    await page.getByRole('heading', { name: '技能广场', exact: true }).waitFor()
    expect(await page.getByRole('article').count()).toBe(2)
    const snapshot = await captureStableAria(page, 'main[aria-busy]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/skill-marketplace/catalog.expected.md', import.meta.url)), snapshot, webSnapshotMode())
    await page.screenshot({ path: join(tmpdir(), 'dsh-skill-marketplace-desktop.png'), fullPage: true })
    for (const width of [320, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(tmpdir(), 'dsh-skill-marketplace-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    const archive = zipSync({
      'cover/SKILL.md': strToU8('---\nname: cover-assistant\ndescription: 当用户需要文章封面时使用\ncategory: writing\n---\n输出封面提示词，参考 references/style.md。'),
      'cover/references/style.md': strToU8('使用清晰的主体和构图'),
      'cover/assets/palette.bin': new Uint8Array([0, 255, 42]),
    })
    await page.getByLabel('Skill ZIP 压缩包').setInputFiles({ name: 'cover.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) })
    await page.getByRole('heading', { name: '导入 Skill', exact: true }).waitFor()
    expect(await page.getByLabel('名称', { exact: true }).inputValue()).toBe('cover-assistant')
    expect(await page.getByLabel('分类', { exact: true }).inputValue()).toBe('writing')
    await page.getByLabel('名称', { exact: true }).fill('封面助手')
    await page.getByPlaceholder('步骤...').fill('读取文章主题')
    await page.getByRole('button', { name: '添加步骤', exact: true }).click()
    await page.getByText('压缩包内容', { exact: true }).click()
    await page.screenshot({ path: join(tmpdir(), 'dsh-skill-import-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: join(tmpdir(), 'dsh-skill-import-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await page.getByRole('heading', { name: '技能广场', exact: true }).waitFor()
    const imported = await scaffold.ctx.skills.get('user-imported-cover-assistant')
    expect(imported?.content).toContain('读取文章主题')
    expect(imported?.resourceBase?.kind).toBe('directory')
    if (imported?.resourceBase?.kind !== 'directory') throw new Error('Imported Skill has no resource directory')
    expect(imported.resourceBase.path.startsWith(join(scaffold.harnessHome, 'skill-imports'))).toBe(true)
    expect(await readFile(join(imported.resourceBase.path, 'references/style.md'), 'utf8')).toBe('使用清晰的主体和构图')
    await page.getByRole('button', { name: '插件', exact: true }).click()
    await page.getByRole('searchbox', { name: '搜索插件' }).waitFor()
    expect(await page.getByText('用户创建的插件', { exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: /封面助手/ }).count()).toBe(0)
    const supportCategory = page.getByRole('tab', { name: /^技能与工作流支持插件/ })
    await supportCategory.click()
    expect(await page.locator('[data-plugin-module="@deepseek-ai/dsh-tool-skill"]').count()).toBeGreaterThan(0)
    const supportSnapshot = await captureStableAria(page, '[data-plugin-category="skills"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/skill-marketplace/support-category.expected.md', import.meta.url)), supportSnapshot, webSnapshotMode())
    await page.screenshot({ path: join(tmpdir(), 'dsh-plugin-support-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: join(tmpdir(), 'dsh-plugin-support-mobile.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
    const warningStart = tripwire.warnings.length
    await page.reload()
    await page.getByRole('button', { name: 'Skill', exact: true }).click()
    await page.getByRole('button', { name: '内容创作', exact: true }).click()
    await page.getByRole('heading', { name: '封面助手' }).waitFor()
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    expect(await page.getByRole('article').count()).toBe(1)
    await page.getByRole('button', { name: '查看详情' }).click()
    await page.getByRole('button', { name: '编辑 Skill' }).click()
    expect(await page.getByLabel('分类', { exact: true }).inputValue()).toBe('writing')
    expect(await page.getByLabel('步骤 1', { exact: true }).inputValue()).toBe('读取文章主题')
    await page.getByRole('button', { name: '返回技能广场' }).click()
    await page.getByRole('button', { name: '用于对话' }).click()
    const importedComposer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await expect.poll(() => importedComposer.innerText()).toBe('/user-imported-cover-assistant ')
    await page.getByRole('button', { name: 'Skill', exact: true }).click()
    await page.getByRole('button', { name: '全部 Skill', exact: true }).click()
    await page.getByRole('button', { name: '全部分类', exact: true }).click()
    await page.getByRole('button', { name: '创建工作流', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '用于对话' }).click()
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await composer.waitFor()
    await expect.poll(() => composer.innerText()).toBe('/make-workflow /user-imported-cover-assistant ')
    await composer.fill('/make-workflow 帮我设计每周报告流程')
    await page.getByRole('button', { name: 'Skill', exact: true }).click()
    await page.getByRole('article').filter({ has: page.getByRole('heading', { name: '创建 Skill', exact: true }) }).getByRole('button', { name: '用于对话' }).click()
    await expect.poll(() => composer.innerText()).toBe('/make-skill /make-workflow 帮我设计每周报告流程')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  } catch (error) {
    await page.screenshot({ path: join(tmpdir(), 'dsh-skill-marketplace-failure.png'), fullPage: true })
    console.error({ pageErrors: tripwire.pageErrors, warnings: tripwire.warnings, page: await page.locator('body').innerText() })
    throw error
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 120_000)
