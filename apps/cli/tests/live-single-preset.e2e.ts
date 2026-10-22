import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SHIPPED_PRESET_ROOT } from '@deepseek-ai/dsh-agent-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot, createProfileResolutionGeneration, loadOverlayPatches,
  PluginPackages, type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'

/**
 * The shipped preset after the five-preset roster was retired.
 *
 * Every case binds the one composition that ships and asks what a session
 * composed from it actually gets: the roster row it is listed as, the prompt
 * it renders, the surfaces it owns, and the command it makes reachable.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const WEB_PATCH = join(REPO_ROOT, 'packages/bundle/web-app/cordis.patch.yml')
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')

/** Boot the shipped composition with every out-of-process row disabled. */
async function bootShipped(): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-single-preset-'))
  const settingsFile = join(root, 'settings.yaml')
  await writeFile(settingsFile, '{}\n')
  const overrides: PatchOptions[] = [
    { id: 'settings', config: { path: settingsFile, watch: false } },
    { id: 'storage-json', config: { root: join(root, 'storages') } },
    { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions') } },
    { id: 'webserver', disabled: true },
    { id: 'web-runtime', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'modules', disabled: true },
    { id: 'connection', disabled: true },
    { id: 'session-log-download', disabled: true },
    { id: 'open-in-app', disabled: true },
    { id: 'client-hmr', disabled: true },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
    { id: 'agent-presets', config: { default: 'diaosi', includeUserRoot: false } },
  ]
  const home = dirname(settingsFile)
  const profileDir = join(home, 'profiles', 'spec')
  await mkdir(profileDir, { recursive: true })
  const profile: Profile = {
    name: 'spec', dir: profileDir, layers: [],
    patchPath: join(profileDir, 'cordis.patch.yml'), patches: [], patchReload: 'startup',
  }
  const bundlePatches: PatchOptions[] = [
    ...loadOverlayPatches('dsh-test', BASE_PATCH),
    ...loadOverlayPatches('dsh-test', WEB_PATCH),
  ]
  const resolution = await createProfileResolutionGeneration({ installAnchor: INSTALL_ANCHOR, home, profile })
  const rootConfig = join(profileDir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  const ctx = await boot('dsh-test', rootConfig, [...bundlePatches, ...overrides], async (bootCtx) => {
    await bootCtx.plugin(PluginPackages, { generation: resolution })
    bootCtx.provide('connection', {
      fetch: { register: () => () => {} },
      rpc: { intercept: () => () => {} },
    } as never)
    provideCmdline(bootCtx, { args: [], exit: () => {} })
  })
  return { ctx, root }
}

const toolNames = (ctx: Context, agent?: Agent): string[] =>
  ctx.tools.schemas(agent).map(schema => schema.name).sort()

describe('the one shipped preset', () => {
  let ctx: Context
  let root: string

  beforeAll(async () => { ({ ctx, root } = await bootShipped()) }, 120_000)

  afterAll(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('lists exactly one shipped preset and makes it the default', async () => {
    const listed = await ctx.agentPresets.list()

    expect(listed.map(preset => preset.id)).toEqual(['diaosi'])
    expect(listed[0]?.trust).toBe('system')
    expect(ctx.agentPresets.defaultId).toBe('diaosi')
  })

  it('reads the composition from the shipped root, not a copy', async () => {
    const preset = await ctx.agentPresets.resolve('diaosi')

    expect(preset.path.startsWith(SHIPPED_PRESET_ROOT)).toBe(true)
    expect(await readFile(preset.path, 'utf8')).toContain('dsh-persona')
  })

  it('composes a session from it with the bounded read surface intact', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('single-preset-read'),
      meta: { cwd: root },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'diaosi').then(() => undefined),
    })
    try {
      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent))
      // The suffix is registered verbatim as a template, so the budget
      // guidance this preset owns is asserted on the section text.
      const persona = assembly.sections.find(section => section.name === 'deployment:persona-suffix')
      expect(persona?.text).toContain('Spend as few tokens')
      const compaction = ctx.agentPresets.serviceFor(handle.agent, 'compaction') as BasicCompactionEngine | undefined
      expect(compaction?.config).toMatchObject({ thresholdRatio: 0.65, retainRatio: 0.12, maxTokens: 4096 })
    } finally {
      await handle.dispose()
    }
  })

  it('reaches the goal command and the task tool from this composition', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('single-preset-goal'),
      meta: { cwd: root },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'diaosi').then(() => undefined),
    })
    try {
      // `/goal` used to be gated on a preset that mounted it; with one preset
      // left it must be reachable here, because that is what the slash menu
      // offers the user.
      expect(ctx.commands.find(handle.agent, 'goal')).toBeDefined()
      // The model-facing side of the same seam: the tool the slash command's
      // domain backs.
      expect(toolNames(ctx, handle.agent)).toEqual(expect.arrayContaining(['get_goal', 'create_goal']))
    } finally {
      await handle.dispose()
    }
  })
})
