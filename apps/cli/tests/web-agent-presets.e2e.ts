import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  boot,
  createProfileResolutionGeneration,
  loadOverlayPatches,
  loadProfile,
  PluginPackages,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
import { SETTINGS_NAMESPACE, SHIPPED_PRESET_ROOT } from '@deepseek-ai/dsh-agent-presets'
import { applyChildComposition, childSessionMeta } from '@deepseek-ai/dsh-subagent'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MockAdapter, toolCallResponse, textResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import type { LocalEmbedding } from '../../../packages/host/knowledge/src/embedding.ts'
import type {} from '../../../packages/host/knowledge/src/index.ts'
import type { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
// Type-only: resolves `ctx.get('sessionProjections')` and `ctx.get('tokenMeter')`.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-token-meter'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
/** The shipped Web surface: the dsh-base and dsh-web-app bundle patches over an empty preset root. */
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const WEB_PATCH = join(REPO_ROOT, 'packages/bundle/web-app/cordis.patch.yml')
const CODEX_PACKAGE_DIR = join(REPO_ROOT, 'packages/subagent/subagent-codex')
const CLAUDE_CODE_PACKAGE_DIR = join(REPO_ROOT, 'packages/subagent/subagent-claude-code')
/** The installation anchor whose dependency surface the preset module fallback mirrors. */
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')
const MINIMAL_PROMPT = 'You are a helpful software engineer assistant running on the {{model}} model from the {{provider}} provider.'
const MINIMAL_BASH_DESCRIPTION = `Run commands in a bash shell
* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.
* Network access depends on the task environment. Prefer configured mirrors/proxies when they are available.
* State is persistent across command calls and discussions with the user.
* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.
* Please avoid commands that may produce a very large amount of output.
* Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.`

/**
 * Boot the shipped Web composition, minus the rows that would bind a port,
 * touch the network, or write outside the test. Everything that decides an
 * agent's capabilities is the real thing, including both shipped presets.
 */
async function bootWeb(
  settingsFile: string,
  extra: PatchOptions[] = [],
  profilePackages: readonly string[] = [],
  profileBundles?: readonly string[],
): Promise<Context> {
  const storageRoot = join(dirname(settingsFile), 'storages')
  const overrides: PatchOptions[] = [
    // The settings row defaults to `$DSH_HOME/settings.yaml`. Left alone it
    // reads the developer's own document — and since the default preset is a
    // setting, a stored `agent-presets.default` would decide this file's
    // outcome. Point it at a temp file for the same reason the roster row
    // below pins `includeUserRoot` off.
    { id: 'settings', config: { path: settingsFile, watch: false } },
    // storage-json's root is anchored to the real $DSH_HOME. Unpinned, this
    // file writes the developer's own `~/.dsh/storages/` — and then reads it
    // back on the next run, so a stored document from any other build decides
    // this test's boot. Same reason the settings row above is pinned.
    { id: 'storage-json', config: { root: storageRoot } },
    // Fixed Session IDs must stay inside this boot's temporary profile root.
    { id: 'session-persistence-jsonl', config: { root: join(dirname(settingsFile), 'sessions') } },
    // Host rows with side effects outside this process: a bound port, a served
    // asset tree, a telemetry exporter. `api-gateway` and `directory-picker`
    // stay ENABLED on purpose — the api-proxy is the host row that injects
    // `subagents`, `workspace`, and the rest of the agent plane, so disabling
    // it would hide exactly the breakage this file exists to catch: a service
    // moved into the presets that a host row still waits for. The boot audit
    // is that assertion.
    { id: 'webserver', disabled: true },
    // The web bundle's runtime row injects `webServer`, so it cannot
    // activate without the bound port disabled above. It owns dist serving
    // and the URL prompt line — surface glue, not anything that decides an
    // agent's capabilities, which is all this file asserts.
    { id: 'web-runtime', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    // A deployment-level skill on the host registry's GLOBAL layer — the same
    // registration shape a repository plugin's skill root uses. The layered
    // skills test below proves it reaches preset-composed agents.
    { id: 'skill-badge', disabled: false },
    { id: 'modules', disabled: true },
    // The physical Connection row owns the disabled HTTP server. bootWeb
    // supplies only its in-process registries so Host services still prove
    // their shipped dependency graph without binding a port.
    { id: 'connection', disabled: true },
    // Export owns a Connection Fetch route, so this Host-only composition
    // disables it with the transport service above.
    { id: 'session-log-download', disabled: true },
    // The open-in-app host routes wait for the webserver and connection
    // rows disabled above (connection's trust fence guards every route).
    { id: 'open-in-app', disabled: true },
    // The always-on reload chain waits for the browser roster and bound port
    // disabled above.
    { id: 'client-hmr', disabled: true },
    // The shipped `-auto` chooser resolves its interaction from a running
    // host and so waits for the webserver disabled above; the browse variant
    // supplies `directoryPicker` without one.
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
    // Pin the roster away from the developer's machine: `includeUserRoot`
    // false keeps `~/.dsh/.agent-presets` from changing a test's outcome.
    // `default` here is the COMPOSITION default — the base layer the settings
    // document overrides. No `roots` entry: the plugin bundles the shipped
    // presets itself and prepends their root.
    { id: 'agent-presets', config: { default: 'standard', includeUserRoot: false } },
    ...extra,
  ]
  const home = dirname(settingsFile)
  const profileDir = join(home, 'profiles', 'spec')
  await mkdir(profileDir, { recursive: true })
  // Product Bundles are installed into the Profile, not the dsh app. Model
  // pnpm's package link for only the selected products; their own production
  // dependencies resolve from the linked workspace packages, while shared
  // peers still resolve through the installation fallback above.
  for (const packageDir of profilePackages) {
    const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as { name: string }
    const link = join(profileDir, 'node_modules', manifest.name)
    await mkdir(dirname(link), { recursive: true })
    await symlink(packageDir, link, 'junction')
  }
  let profile: Profile = {
    name: 'spec',
    dir: profileDir,
    layers: [],
    patchPath: join(profileDir, 'cordis.patch.yml'),
    patches: [],
    patchReload: 'startup',
  }
  let bundlePatches: PatchOptions[] = [
    ...loadOverlayPatches('dsh-test', BASE_PATCH),
    ...loadOverlayPatches('dsh-test', WEB_PATCH),
  ]
  if (profileBundles !== undefined) {
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      private: true,
      dependencies: Object.fromEntries(profileBundles.map(name => [name, 'workspace:*'])),
      dsh: { profile: { bundles: profileBundles } },
    }, null, 2) + '\n')
    profile = loadProfile('dsh-test', 'spec', INSTALL_ANCHOR, home, { userLayer: false })
    bundlePatches = profile.layers.flatMap(layer => layer.patches)
  }
  const resolution = await createProfileResolutionGeneration({ installAnchor: INSTALL_ANCHOR, home, profile })
  const rootConfig = join(profileDir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  return await boot('dsh-test', rootConfig, [...bundlePatches, ...overrides], async (bootCtx) => {
    await bootCtx.plugin(PluginPackages, { generation: resolution })
    bootCtx.provide('connection', {
      fetch: { register: () => () => {} },
      rpc: { intercept: () => () => {} },
    } as never)
    provideCmdline(bootCtx, { args: [], exit: () => {} })
  })
}

const toolNames = (ctx: Context, agent?: Agent): string[] =>
  ctx.tools.schemas(agent).map(schema => schema.name).sort()

function toolParameterNames(ctx: Context, agent: Agent, toolName: string): string[] {
  const schema = ctx.tools.schemas(agent).find(tool => tool.name === toolName)
  if (schema === undefined) throw new Error(`missing tool schema ${toolName}`)
  const properties = schema.parameters.properties
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Error(`${toolName} has invalid parameter properties`)
  }
  return Object.keys(properties).sort()
}

function enablePresetTool(composition: string, id: string): string {
  const row = `    - id: ${id}\n`
  const start = composition.indexOf(row)
  if (start < 0) throw new Error(`missing preset row ${id}`)
  const end = composition.indexOf('\n    - id:', start + row.length)
  const disabled = composition.indexOf('      disabled: true\n', start)
  if (disabled < 0 || (end >= 0 && disabled > end)) {
    throw new Error(`preset row ${id} is not disabled`)
  }
  return composition.slice(0, disabled) + composition.slice(disabled + '      disabled: true\n'.length)
}

let ctx: Context
beforeAll(async () => {
  const settingsFile = join(await mkdtemp(join(tmpdir(), 'dsh-web-presets-')), 'settings.yaml')
  await writeFile(settingsFile, '{}\n')
  ctx = await bootWeb(settingsFile)
}, 120_000)

describe('the shipped Web composition', () => {
  it('retrieves knowledge through the preset tool catalog and persists source excerpts in the session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-composition-'))
    const knowledgeCtx = await bootWeb(join(root, 'settings.yaml'), [{ id: 'session-title-llm', disabled: true }])
    // Loader imports the built Host; replace only its external embedding inference.
    const inference = (knowledgeCtx.knowledge as unknown as { embedding: LocalEmbedding }).embedding
    const embed = vi.spyOn(inference, 'embed').mockImplementation(async texts => texts.map(() => [1, 0, 0]))
    try {
      await knowledgeCtx.knowledge.save({
        id: 'knowledge-fixture' as never, title: '差旅知识库', description: '', enabled: true,
        revision: 0, split: { mode: 'recursive', size: 400, overlap: 60 },
        documents: [{ id: 'travel' as never, title: '报销规则', content: '住宿每晚最多报销四百元，需要电子发票和出差审批单。', updatedAt: 1 }],
      })
      await vi.waitFor(async () => expect((await knowledgeCtx.knowledge.overview()).bases[0]?.index.status).toBe('ready'))
      const adapter = new MockAdapter([
        toolCallResponse('find-knowledge', 'tool_search', { query: 'knowledge' }),
        toolCallResponse('list-knowledge', 'knowledge_list', {}),
        toolCallResponse('search-knowledge', 'knowledge_search', { query: '酒店费用和凭证', baseId: 'knowledge-fixture' }),
        textResponse('住宿每晚最多报销四百元，需要电子发票和出差审批单。来源：差旅知识库 / 报销规则。'),
      ])
      const removeAdapter = knowledgeCtx.llm.registerAdapter(['knowledge-fixture'], adapter)
      const handle = await knowledgeCtx.agents.create({
        sessionId: SessionId('knowledge-retrieval'), meta: { cwd: root },
        agentOptions: { provider: 'knowledge-fixture', model: 'fixture' },
        setup: agentCtx => knowledgeCtx.agentPresets.mount(agentCtx, 'diaosi').then(() => undefined),
      })
      try {
        expect(toolNames(knowledgeCtx, handle.agent)).toEqual(expect.arrayContaining(['knowledge_list', 'knowledge_search']))
        handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '查询知识库：出差酒店费用和凭证。' }] }))
        await handle.agent.whenIdle()
        expect(adapter.requests).toHaveLength(4)
        const observation = await knowledgeCtx.sessionQuery.observeSession(handle.agent.session.id, { projectionMode: 'none' })
        try {
          const results = observation.events.filter(event => event.type === 'tool/result').map(event => event.data.message.content)
          expect(results).toHaveLength(3)
          expect(results).toMatchSnapshot('knowledge retrieval source excerpts')
          expect(adapter.requests[3]?.messages.some(message => JSON.stringify(message).includes('住宿每晚最多报销四百元'))).toBe(true)
        } finally { observation[Symbol.dispose]() }
      } finally { await handle.dispose(); removeAdapter() }
      await knowledgeCtx.knowledge.deleteBase('knowledge-fixture' as never, 1)
      expect(toolNames(knowledgeCtx)).not.toContain('knowledge_search')
    } finally {
      embed.mockRestore()
      await knowledgeCtx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('leaves the global tool layer empty', () => {
    // Every model-facing tool belongs to a preset, `ask_user_question`
    // included: a tool in the global layer reaches EVERY agent regardless of
    // which preset composed it, expanding that preset's tool list.
    expect(toolNames(ctx)).toEqual([])
  })

  it('keeps the token meter and its context-meter projections on the host plane', async () => {
    // Read before any preset in this file mounts, which is what makes this an
    // ownership assertion rather than a mount-order coincidence: a preset-side
    // meter sits behind an `isolate` realm and is invisible to `ctx.get`.
    //
    // The projection registry is process-wide rather than scope-layered, so a
    // preset-side meter would also make the browser's context meter appear for
    // a `minimal` session the moment some OTHER session mounted a preset that
    // carries one, and vanish entirely in a process that only ever ran
    // `minimal`. Host ownership is what makes the meter a per-session fact.
    expect(ctx.get('tokenMeter')).toBeDefined()
    const projections = ctx.get('sessionProjections')
    if (projections === undefined) throw new Error('the Web composition must compose a projection registry')
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-minimal-meter'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
    try {
      // A subset assertion: `tasks`, `goal`, and the rest register into the
      // same process-wide table, and this is about the meter's three units.
      expect(Object.keys(projections.snapshot(handle.agent.session).values))
        .toEqual(expect.arrayContaining(['contextBreakdown', 'contextPressure', 'tokenUsage']))
    } finally {
      await handle.dispose()
    }
  })

  it('supplies the shipped presets, and only those, from the system root', async () => {
    const listed = await ctx.agentPresets.list()

    expect(listed.map(preset => preset.id).sort()).toEqual(['cordis', 'diaosi', 'minimal', 'ptc', 'standard'])
    expect(listed.every(preset => preset.trust === 'system')).toBe(true)
    expect(ctx.agentPresets.defaultId).toBe('standard')
  })

  it('composes the full agent from `standard`', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-standard'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    try {
      // The EXACT catalog, not a spot-check: an omission is this design's
      // quietest failure mode, because a row that registers into the wrong
      // layer mounts cleanly and simply contributes nothing. `glob`/`grep` are
      // excluded for the reason the TUI composition e2e excludes them — they
      // depend on ripgrep being present on the machine.
      expect(toolNames(ctx, handle.agent).filter(name => name !== 'glob' && name !== 'grep')).toEqual([
        'ask_user_question', 'bash', 'create_goal', 'edit', 'exit_plan_mode',
        'get_goal', 'interrupt_agent', 'job_kill', 'job_list', 'job_output', 'list_agents', 'present', 'read', 'read_image', 'send_message', 'skill',
        'subagent', 'subagent_fork', 'todo_write', 'update_goal', 'web_fetch', 'web_search',
        'workflow', 'write',
      ])
      expect(ctx.commands.find(handle.agent, 'goal')).toBeDefined()
    } finally {
      await handle.dispose()
    }
  })

  it('bounds diaosi reads and search results without changing standard or the selected model', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-diaosi-'))
    const filePath = join(directory, 'lines.txt')
    const widePath = join(directory, 'wide.txt')
    await writeFile(filePath, Array.from({ length: 200 }, (_, index) => `match-${index + 1}\n`).join(''))
    await writeFile(widePath, `${'x'.repeat(900)}\n`.repeat(20))
    const budget = await ctx.agents.create({
      sessionId: SessionId('preset-diaosi-budget'),
      meta: { cwd: directory },
      agentOptions: { provider: 'custom-provider', model: 'custom-model' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'diaosi').then(() => undefined),
    })
    const standard = await ctx.agents.create({
      sessionId: SessionId('preset-diaosi-standard'),
      meta: { cwd: directory },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    const execute = async (agent: Agent, name: string, args: Record<string, unknown>): Promise<string> => {
      const result = await ctx.tools.execute({
        callId: ToolCallId(randomUUID()), name, arguments: args,
        signal: new AbortController().signal, agent,
      })
      expect(result.isError, JSON.stringify(result.content)).toBe(false)
      return result.content.map(block => block.type === 'text' ? block.text : '').join('')
    }
    try {
      expect(toolNames(ctx, budget.agent).filter(name => name !== 'glob' && name !== 'grep')).toEqual([
        'ask_user_question', 'bash', 'edit', 'job_kill', 'job_list', 'job_output',
        'present', 'read', 'read_image', 'skill', 'todo_write', 'tool_search', 'web_fetch', 'web_search', 'write',
      ])
      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(budget.agent))
      expect(assembly.tools).toHaveLength(5)
      expect(assembly.tools.map(tool => tool.name)).toContain('tool_search')
      expect(renderPrompt(assembly)).toContain('powered by the custom-model model from the custom-provider provider')
      expect(assembly.sections.filter(section => section.name.startsWith('deployment:persona')))
        .toMatchSnapshot('diaosi persona')
      const compaction = ctx.agentPresets.serviceFor(budget.agent, 'compaction')
      expect(compaction).toBeDefined()
      expect((compaction as BasicCompactionEngine).config).toMatchObject({
        thresholdRatio: 0.65, retainRatio: 0.12, maxTokens: 4096,
      })
      expect(compaction).not.toBe(ctx.agentPresets.serviceFor(standard.agent, 'compaction'))
      expect(ctx.commands.find(budget.agent, 'compact')).toBeDefined()

      const first = await execute(budget.agent, 'read', { file_path: filePath })
      expect(first).toContain('120: match-120')
      expect(first).not.toContain('121: match-121')
      expect(first).toContain('Use offset=121 to continue')
      expect(await execute(budget.agent, 'read', { file_path: filePath, offset: 121 }))
        .toContain('200: match-200')
      expect(await execute(standard.agent, 'read', { file_path: filePath })).toContain('200: match-200')

      const wide = await execute(budget.agent, 'read', { file_path: widePath })
      expect(wide).toContain('Output capped. Showing lines 1-8. Use offset=9 to continue.')
      expect(await execute(standard.agent, 'read', { file_path: widePath })).toContain('End of file - total 20 lines')

      const spillPath = join(directory, 'shell-output.txt')
      await writeFile(spillPath, 'shell-output\n'.repeat(5000))
      const shellArgs = { command: `cat '${spillPath}'`, description: 'Read the spill fixture' }
      const bounded = await execute(budget.agent, 'bash', shellArgs)
      expect(bounded).toContain('Full formatted result stored at:')
      expect(Buffer.byteLength(bounded)).toBeLessThanOrEqual(8000)
      const savedPath = bounded.match(/Full formatted result stored at: (.+?)\. Use read/)?.[1]
      expect(savedPath).toBeDefined()
      const savedText = await readFile(savedPath!, 'utf8')
      expect(savedText).not.toContain('Full formatted result stored at:')
      expect(savedText).toContain('shell-output\n'.repeat(1000))
      const originalPath = savedText.match(/full output: ([^\]]+)\]/)?.[1]
      expect(originalPath).toBeDefined()
      expect(await readFile(originalPath!, 'utf8')).toBe('shell-output\n'.repeat(5000))
      const standardOutput = await execute(standard.agent, 'bash', shellArgs)
      expect(standardOutput).toContain('Full formatted result stored at:')
      expect(Buffer.byteLength(standardOutput)).toBeGreaterThan(8000)
      expect(Buffer.byteLength(standardOutput)).toBeLessThanOrEqual(50000)

      if (toolNames(ctx, budget.agent).includes('grep')) {
        expect(await execute(budget.agent, 'grep', { pattern: 'match-', path: directory, include: 'lines.txt' }))
          .toContain('Found 40 of 200 matches')
        expect(await execute(standard.agent, 'grep', { pattern: 'match-', path: directory, include: 'lines.txt' }))
          .toContain('Found 200 matches')
      }
    } finally {
      await budget.dispose()
      await standard.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('discovers inherited media tools in diaosi and records the bounded catalogs seen by the model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-diaosi-discovery-'))
    const ctx = await bootWeb(join(root, 'settings.yaml'), [{ id: 'session-title-llm', disabled: true }])
    try {
      const removeTools = ['generate_image', 'generate_speech', 'list_image_models', 'list_speech_models'].map(name =>
        ctx.tools.register(defineTool({ name, description: `Fixture ${name}`, parameters: {},
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
          async execute() { return 'media fixture completed' },
        })))
      const adapter = new MockAdapter([
        toolCallResponse('find-image', 'tool_search', { query: 'generate_image' }),
        toolCallResponse('use-image', 'generate_image', {}),
        textResponse('done'),
      ])
      const removeAdapter = ctx.llm.registerAdapter(['discovery-fixture'], adapter)
      const handle = await ctx.agents.create({
        sessionId: SessionId('preset-diaosi-discovery'),
        meta: { cwd: root },
        agentOptions: { provider: 'discovery-fixture', model: 'fixture' },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'diaosi').then(() => undefined),
      })
      try {
        const full = ctx.tools.schemas(handle.agent)
        const before = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent))
        expect(before.tools).toHaveLength(5)
        expect(before.tools.map(tool => tool.name)).not.toContain('generate_image')
        expect(JSON.stringify(before.tools).length).toBeLessThan(JSON.stringify(full).length / 2)
        const errors: string[] = []
        ctx.on('agent/error', ({ error }) => { errors.push(String(error)) })
        handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Generate an image.' }] }))
        await handle.agent.whenIdle()
        expect(errors).toEqual([])
        expect(adapter.requests).toHaveLength(3)
        const catalogs = adapter.requests.map(request => request.tools?.map(tool => tool.name))
        expect(catalogs[0]).not.toContain('generate_image')
        expect(catalogs[1]).toContain('generate_image')
        expect(catalogs[2]).toEqual(catalogs[1])
        expect(catalogs.flat()).not.toContain('generate_speech')
        const observation = await ctx.sessionQuery.observeSession(handle.agent.session.id, { projectionMode: 'none' })
        try {
          const headers = observation.events.filter(event => event.type === 'request/header').map(event => event.data.header.tools?.map(tool => tool.name))
          expect(headers).toEqual([catalogs[0], catalogs[1]])
          const results = observation.events.filter(event => event.type === 'tool/result')
            .map(event => ({ content: event.data.message.content, meta: event.data.meta }))
          expect({ catalogs, results, searchTool: before.tools.find(tool => tool.name === 'tool_search') }).toMatchSnapshot('diaosi on-demand media tools')
        } finally { observation[Symbol.dispose]() }
      } finally {
        await handle.dispose()
        removeAdapter()
        for (const remove of removeTools) remove()
      }
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps compact diaosi instructions and skill catalogs in recorded requests without changing standard', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-diaosi-context-'))
    await writeFile(join(root, 'AGENTS.md'), 'Project rule: verify exported data before reporting success.\n')
    const ctx = await bootWeb(join(root, 'settings.yaml'), [{ id: 'session-title-llm', disabled: true }])
    try {
      const removeSkill = ctx.skills.register({ name: 'budget-proof', description: 'Use for budget verification.', source: 'runtime', content: 'Full skill instructions remain available.' })
      const adapter = new MockAdapter([textResponse('hello'), textResponse('hello')])
      const removeAdapter = ctx.llm.registerAdapter(['context-fixture'], adapter)
      const observed: Record<string, unknown>[] = []
      try {
        for (const preset of ['diaosi', 'standard']) {
          const handle = await ctx.agents.create({
            sessionId: SessionId(`preset-${preset}-context`), meta: { cwd: root },
            agentOptions: { provider: 'context-fixture', model: 'fixture' },
            setup: agentCtx => ctx.agentPresets.mount(agentCtx, preset).then(() => undefined),
          })
          try {
            handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello.' }] }))
            await handle.agent.whenIdle()
            const events = handle.agent.session.snapshotEvents()
            const system = events.find(event => event.type === 'system/message')
            const catalog = events.find(event => event.type === 'user/message' && event.data.source.kind === 'skill-catalog')
            expect(catalog?.type).toBe('user/message')
            if (catalog?.type !== 'user/message') throw new Error('Missing skill catalog')
            expect(JSON.stringify(catalog.data.content).includes('Summaries are not instructions')).toBe(preset === 'diaosi')
            const request = adapter.requests.at(-1)!
            expect(JSON.stringify(request.messages)).toContain('verify exported data before reporting success')
            expect(JSON.stringify(request.messages)).toContain('Approval policy:')
            expect(JSON.stringify(request.messages)).toContain('Current DSH file policy:')
            expect(JSON.stringify(request.messages)).toContain('fixture')
            if (preset === 'diaosi') expect(JSON.stringify(request.messages)).toContain('context-fixture')
            expect(request.messages.some(message => JSON.stringify(message.content) === JSON.stringify(catalog.data.content))).toBe(true)
            expect(JSON.stringify(system).includes('Keep replies concise unless detail is requested')).toBe(preset === 'diaosi')
            observed.push({ preset, catalog: catalog.data.content })
          } finally { await handle.dispose() }
        }
        expect(adapter.requests).toHaveLength(2)
        expect(observed).toMatchSnapshot('scoped skill catalog styles')
      } finally { removeSkill(); removeAdapter() }
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })

  it('applies the default-off subagent model allowlist only to new sessions', async () => {
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: false,
      allowedModels: [],
    })
    const disabled = await ctx.agents.create({
      sessionId: SessionId('preset-model-selection-disabled'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: true,
      allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
    })
    const enabled = await ctx.agents.create({
      sessionId: SessionId('preset-model-selection-enabled'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    try {
      expect(toolNames(ctx, disabled.agent)).not.toContain('list_subagent_models')
      expect(toolParameterNames(ctx, disabled.agent, 'subagent')).not.toEqual(expect.arrayContaining([
        'model', 'provider', 'reasoning_effort',
      ]))
      expect(toolNames(ctx, enabled.agent)).toContain('list_subagent_models')
      expect(toolParameterNames(ctx, enabled.agent, 'subagent')).toEqual(expect.arrayContaining([
        'model', 'provider', 'reasoning_effort',
      ]))
      expect(toolNames(ctx, disabled.agent)).not.toContain('list_subagent_models')
    } finally {
      await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, { enabled: false })
      await enabled.dispose()
      await disabled.dispose()
    }
  })

  it.each([
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'custom-provider', model: 'custom-model' },
  ])('composes minimal with the selected $provider/$model identity and persistent shell', async (route) => {
    const handle = await ctx.agents.create({
      sessionId: SessionId(`preset-minimal-${route.provider}`),
      agentOptions: route,
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
    try {
      const assembly = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent))
      expect(assembly.sections).toEqual([
        { name: 'deployment:persona-prefix', text: MINIMAL_PROMPT },
      ])
      expect(renderPrompt(assembly)).toBe(
        `You are a helpful software engineer assistant running on the ${route.model} model from the ${route.provider} provider.`,
      )
      expect(assembly.contexts).toEqual([])
      expect(assembly.tools.map(tool => tool.name)).toEqual(['bash'])
      expect(assembly.tools.find(tool => tool.name === 'bash')?.description).toBe(MINIMAL_BASH_DESCRIPTION)
      expect(ctx.commands.find(handle.agent, 'goal')).toBeUndefined()
      // serviceFor reports preset-owned providers; unisolated consumers inherit the host fs.
      expect(ctx.agentPresets.serviceFor(handle.agent, 'fs')).toBeUndefined()
      expect(ctx.get('fs')?.sandboxMode).toBeDefined()
      expect(handle.agent.ctx.get('fs')?.sandboxMode).toBe(ctx.get('fs')?.sandboxMode)
      expect(ctx.agentPresets.serviceFor(handle.agent, 'compaction')).toBeUndefined()
      expect(handle.agent.ctx.get('compaction')).toBeUndefined()
    } finally {
      await handle.dispose()
    }
  })

  it('keeps two differently composed sessions independent', async () => {
    const full = await ctx.agents.create({
      sessionId: SessionId('preset-both-full'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    const minimal = await ctx.agents.create({
      sessionId: SessionId('preset-both-minimal'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
    try {
      expect(toolNames(ctx, minimal.agent)).toEqual(['bash'])
      expect(toolNames(ctx, full.agent).length).toBeGreaterThan(10)

      await minimal.dispose()

      // Tearing the minimal session down leaves the full one whole.
      expect(toolNames(ctx, full.agent).length).toBeGreaterThan(10)
      expect(toolNames(ctx)).toEqual([])
    } finally {
      await full.dispose()
    }
  })

  it('composes the cordis agent with its own toolset', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-cordis'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'cordis').then(() => undefined),
    })
    try {
      const tools = toolNames(ctx, handle.agent)
      // The self-referential toolset is what distinguishes this preset.
      expect(tools).toEqual(expect.arrayContaining([
        'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
        'cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine',
      ]))
      // And it keeps the standard agent's own tools rather than replacing them.
      expect(tools).toEqual(expect.arrayContaining(['bash', 'read', 'edit', 'skill']))
      expect(tools).not.toContain('str_replace_editor')
      expect(ctx.commands.find(handle.agent, 'goal')).toBeDefined()

      // The preset's own authoring skill registers into ITS layer of the host
      // registry: the cordis agent's view carries it, the global view does not.
      const scoped = (await ctx.skills.list({ scope: handle.agent })).map(skill => skill.name)
      expect(scoped).toContain('editing-cordis-compositions')
      expect((await ctx.skills.list()).map(skill => skill.name)).not.toContain('editing-cordis-compositions')
    } finally {
      await handle.dispose()
    }
  })

  it('presents `ptc` as PTC mode without disturbing a native session beside it', async () => {
    const coded = await ctx.agents.create({
      sessionId: SessionId('preset-ptc'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'ptc').then(() => undefined),
    })
    const native = await ctx.agents.create({
      sessionId: SessionId('preset-ptc-native'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    try {
      // One tool reaches the MODEL: the transport. The registry's catalog for
      // this agent is unchanged — PTC mode collapses the presentation, not
      // the capabilities — so the assembly is what carries the claim.
      const assembly = await ctx.systemPrompt.assemble({ scope: coded.agent })
      expect(assembly.tools.map(tool => tool.name)).toEqual(['run_code'])
      expect(toolNames(ctx, coded.agent)).not.toContain('str_replace_editor')
      expect(ctx.commands.find(coded.agent, 'goal')).toBeDefined()
      const sdk = assembly.sections.find(section => section.name === 'tools:sdk')?.text ?? ''
      expect(sdk).not.toContain('str_replace_editor')
      expect(sdk).toContain('web_search')

      // The presentation is this agent's alone: the deployment default is
      // native, and the session composed from `standard` still sees it.
      const nativeAssembly = await ctx.systemPrompt.assemble({ scope: native.agent })
      expect(nativeAssembly.tools.map(tool => tool.name)).toContain('bash')
      expect(nativeAssembly.tools.map(tool => tool.name)).not.toContain('run_code')
      expect(nativeAssembly.sections.some(section => section.name === 'tools:sdk')).toBe(false)
    } finally {
      await native.dispose()
      await coded.dispose()
    }
  })

  it('keeps the self-referential toolset out of every other preset', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-no-cordis'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    try {
      // Editing the live runtime is opt-in per session, not ambient.
      expect(toolNames(ctx, handle.agent)).not.toContain('cordis_define')
    } finally {
      await handle.dispose()
    }
  })

  it('ships the composition-authoring skill inside the preset directory', async () => {
    // The preset's skill root is derived from its own `baseUrl`, so the skill
    // travels with the directory wherever the preset is installed.
    const skill = join(
      SHIPPED_PRESET_ROOT, 'cordis', 'skills', 'editing-cordis-compositions', 'SKILL.md',
    )

    expect((await readFile(skill, 'utf8')).startsWith('---\nname: editing-cordis-compositions')).toBe(true)
  })

  it('merges the global skill layer into a preset agent\'s catalog, keeping local discovery preset-side', async () => {
    const proj = await mkdtemp(join(tmpdir(), 'dsh-preset-skill-proj-'))
    await mkdir(join(proj, '.dsh', 'skills', 'project-proof'), { recursive: true })
    await writeFile(join(proj, '.dsh', 'skills', 'project-proof', 'SKILL.md'), [
      '---',
      'name: project-proof',
      'description: Proves the preset layer discovers project skills beside global ones.',
      '---',
      '',
      'Project proof body.',
      '',
    ].join('\n'))

    const handle = await ctx.agents.create({
      // Unique per run: the composition persists into the ambient DSH home,
      // and a fixed id would collide with a log an earlier run left there.
      sessionId: SessionId(`preset-skills-standard-${randomUUID()}`),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    try {
      // The host (global) view carries the deployment-level provider alone:
      // local discovery moved behind the presets with `skill-filesystem`.
      expect((await ctx.skills.list({ cwd: proj })).map(skill => skill.name).sort())
        .toEqual(['dsh-badge', 'make-skill', 'make-workflow'])

      // The standard agent's view merges the global layer with its preset's
      // own local discovery over the session cwd.
      const scoped = (await ctx.skills.list({ cwd: proj, scope: handle.agent })).map(skill => skill.name)
      expect(scoped).toContain('dsh-badge')
      expect(scoped).toContain('project-proof')

      // The preset's own loader tool resolves the global-layer skill.
      const loaded = await ctx.tools.execute({
        callId: ToolCallId('preset-skills-load'),
        name: 'skill',
        arguments: { name: 'dsh-badge' },
        signal: new AbortController().signal,
        agent: handle.agent,
      })
      expect(loaded.isError).toBe(false)
      expect(JSON.stringify(loaded.content)).toContain('powered by dsh')
    } finally {
      await handle.dispose()
    }
  })

  it('shows a minimal agent the global layer but no loader tool', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId(`preset-skills-minimal-${randomUUID()}`),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
    try {
      // Layer visibility is the registry's; whether an agent can USE skills
      // stays the preset's choice — minimal mounts no `tool-skill`, so its
      // tool table has no loader even though the global layer is readable.
      expect((await ctx.skills.list({ scope: handle.agent })).map(skill => skill.name)).toContain('dsh-badge')
      expect(toolNames(ctx, handle.agent)).toEqual(['bash'])
    } finally {
      await handle.dispose()
    }
  })

  it('never rewrites the preset file it composed from', async () => {
    // The Loader persists a tree whose plugin self-disposed, and tearing an
    // agent down disposes its whole subtree. Inherited, that rewrote the
    // shipped composition — truncating it to `[]` the first time a session
    // ended — so `PresetTree` refuses to write at all.
    const path = join(SHIPPED_PRESET_ROOT, 'standard', 'agent.cordis.yml')
    const before = await readFile(path, 'utf8')

    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-readonly'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    await handle.dispose()
    // Slack, not a race the number has to win. The write is driven by the
    // Loader's fiber-unload listener, which fires as the subtree's fibers
    // settle rather than when `dispose()` resolves, and the Loader exposes no
    // flush to await. A regression writes synchronously inside that listener,
    // so any wait past settlement fails; a longer one only slows the test.
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(await readFile(path, 'utf8')).toBe(before)
  })
})

describe('product Bundle and user-preset intersection', () => {
  const presetIds = ['products-none', 'products-codex', 'products-claude', 'products-both'] as const
  type Product = 'codex' | 'claude-code'
  type PresetId = typeof presetIds[number]

  async function bootProducts(installed: readonly Product[]): Promise<Context> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-product-presets-'))
    const userRoot = join(root, 'presets')
    const settingsFile = join(root, 'settings.yaml')
    const standard = await readFile(join(SHIPPED_PRESET_ROOT, 'standard', 'agent.cordis.yml'), 'utf8')
    await writeFile(settingsFile, '{}\n')
    for (const id of presetIds) {
      let composition = standard
      if (id === 'products-codex' || id === 'products-both') {
        composition = enablePresetTool(composition, 'tool-subagent-codex')
      }
      if (id === 'products-claude' || id === 'products-both') {
        composition = enablePresetTool(composition, 'tool-subagent-claude-code')
      }
      const directory = join(userRoot, id)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'agent.cordis.yml'), composition)
    }
    const packageDir = (product: Product): string => (
      product === 'codex' ? CODEX_PACKAGE_DIR : CLAUDE_CODE_PACKAGE_DIR
    )
    const packageName = (product: Product): string => (
      product === 'codex'
        ? '@deepseek-ai/dsh-subagent-codex'
        : '@deepseek-ai/dsh-subagent-claude-code'
    )
    return await bootWeb(settingsFile, [
      {
        id: 'agent-presets',
        config: {
          default: 'standard',
          // The shipped root is the plugin's own, prepended before this.
          roots: [{ path: userRoot, trust: 'user' }],
          includeUserRoot: false,
        },
      },
    ], installed.map(packageDir), [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      ...installed.map(packageName),
    ])
  }

  it('composes the intersection of installed Bundles and enabled preset rows', async () => {
    const enabledByPreset: Record<PresetId, Product[]> = {
      'products-none': [],
      'products-codex': ['codex'],
      'products-claude': ['claude-code'],
      'products-both': ['codex', 'claude-code'],
    }
    const scenarios: Array<{ installed: Product[]; presets: readonly PresetId[] }> = [
      { installed: [], presets: ['products-both'] },
      { installed: ['codex'], presets: ['products-both'] },
      { installed: ['claude-code'], presets: ['products-both'] },
      { installed: ['codex', 'claude-code'], presets: presetIds },
    ]

    for (const { installed, presets } of scenarios) {
      const productCtx = await bootProducts(installed)
      const spawn = vi.spyOn(productCtx.subprocess, 'spawn')
      try {
        expect(productCtx.subagents.list()
          .filter(name => name === 'codex' || name === 'claude-code')
          .sort())
          .toEqual([...installed].sort())
        for (const id of presets) {
          const handle = await productCtx.agents.create({
            sessionId: SessionId(`preset-${id}-${installed.join('-') || 'none'}-${randomUUID()}`),
            setup: agentCtx => productCtx.agentPresets.mount(agentCtx, id).then(() => undefined),
          })
          try {
            const productTools = enabledByPreset[id]
              .filter(product => installed.includes(product))
              .map(product => product === 'codex' ? 'subagent_codex' : 'subagent_claude_code')
              .sort()
            const tools = toolNames(productCtx, handle.agent)
            expect(tools.filter(name => name === 'subagent_codex' || name === 'subagent_claude_code'))
              .toEqual(productTools)
            expect(tools).toEqual(expect.arrayContaining(['job_kill', 'job_list', 'job_output']))
            for (const productTool of productTools) {
              expect(toolParameterNames(productCtx, handle.agent, productTool)).toEqual([
                'description', 'prompt', 'run_in_background',
              ])
            }
          } finally {
            await handle.dispose()
          }
        }
        expect(spawn).not.toHaveBeenCalled()
      } finally {
        spawn.mockRestore()
        await productCtx.fiber.dispose()
      }
    }
  }, 120_000)

  it('applies a product-row edit only to later sessions on the preset', async () => {
    const productCtx = await bootProducts(['codex'])
    const preset = await productCtx.agentPresets.resolve('products-none')
    const original = await readFile(preset.path, 'utf8')
    const existing = await productCtx.agents.create({
      sessionId: SessionId('preset-product-generation-existing'),
      setup: agentCtx => productCtx.agentPresets.mount(agentCtx, 'products-none').then(() => undefined),
    })
    try {
      expect(toolNames(productCtx, existing.agent)).not.toContain('subagent_codex')
      await writeFile(preset.path, enablePresetTool(original, 'tool-subagent-codex'))

      const later = await productCtx.agents.create({
        sessionId: SessionId('preset-product-generation-later'),
        setup: agentCtx => productCtx.agentPresets.mount(agentCtx, 'products-none').then(() => undefined),
      })
      try {
        expect(toolNames(productCtx, existing.agent)).not.toContain('subagent_codex')
        expect(toolNames(productCtx, later.agent)).toContain('subagent_codex')
      } finally {
        await later.dispose()
      }
    } finally {
      await existing.dispose()
      await writeFile(preset.path, original)
      await productCtx.fiber.dispose()
    }
  }, 120_000)
})

describe('a switch survives the session', () => {
  it('records the choice so the log states what the agent runs', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-switch-logged'),
      meta: { agentPreset: 'standard' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    try {
      // The api-proxy's select does exactly this pair while the session is blank.
      expect(ctx.commands.find(handle.agent, 'goal')).toBeDefined()
      await ctx.agentPresets.recompose(handle.agent.ctx, 'minimal')
      handle.agent.session.append('agent-preset/selected', { agentPreset: 'minimal' })
      expect(ctx.commands.find(handle.agent, 'goal')).toBeUndefined()

      // The header keeps the creation fact; the log carries what it runs.
      expect(handle.agent.session.header.agentPreset).toBe('standard')
      expect(ctx.sessionProjections.stateOf(handle.agent.session, 'agentPreset')).toBe('minimal')
    } finally {
      await handle.dispose()
    }
  })

})

describe('a forked session', () => {
  it('inherits the composition its seeded history was produced under', async () => {
    const parent = await ctx.agents.create({
      sessionId: SessionId('preset-fork-parent'),
      meta: { agentPreset: 'minimal' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
    const inherited = ctx.sessionProjections.stateOf(parent.agent.session, 'agentPreset') ?? undefined
    const child = await ctx.agents.create({
      sessionId: SessionId('preset-fork-child'),
      seed: [],
      inheritedEventCount: SessionLogOffset(0),
      meta: {
        parentSession: SessionId('preset-fork-parent'),
        isSeeded: true,
        ...inherited === undefined ? {} : { agentPreset: inherited },
      },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, inherited).then(() => undefined),
    })
    try {
      // Composing nothing would leave the child empty: this layer moved every
      // model-facing row out of the host plane, so there is nothing to inherit
      // for free any more.
      expect(toolNames(ctx, child.agent)).toEqual(toolNames(ctx, parent.agent))
      expect(toolNames(ctx, child.agent).length).toBeGreaterThan(0)
    } finally {
      await child.dispose()
      await parent.dispose()
    }
  })
})

describe('a delegated child', () => {
  it('runs on the composition its parent runs on', async () => {
    const parent = await ctx.agents.create({
      sessionId: SessionId('preset-child-parent'),
      meta: { agentPreset: 'standard' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    // Exactly what an in-process subagent driver's creation window does.
    const child = await parent.agent.ctx.agents.create({
      sessionId: SessionId('preset-child'),
      meta: childSessionMeta(parent.agent, 1, false),
      setup: (agentCtx) => {
        applyChildComposition(agentCtx, parent.agent, {})
      },
    })
    try {
      expect(toolNames(ctx, child.agent)).toEqual(toolNames(ctx, parent.agent))
      // The shipped `standard` preset is the whole coding agent; an empty
      // child here is the defect, and equality alone would not catch it.
      expect(toolNames(ctx, child.agent)).toContain('bash')
      expect(child.agent.session.header.agentPreset).toBe('standard')
    } finally {
      await child.dispose()
      await parent.dispose()
    }
  })

  it('follows a parent that switched preset while blank', async () => {
    const parent = await ctx.agents.create({
      sessionId: SessionId('preset-child-switch-parent'),
      meta: { agentPreset: 'standard' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    await ctx.agentPresets.recompose(parent.agent.ctx, 'minimal')
    const child = await parent.agent.ctx.agents.create({
      sessionId: SessionId('preset-child-switch'),
      meta: childSessionMeta(parent.agent, 1, false),
      setup: (agentCtx) => {
        applyChildComposition(agentCtx, parent.agent, {})
      },
    })
    try {
      // The live scope chain is the authority, not the parent's creation
      // header — which still names `standard`.
      expect(toolNames(ctx, child.agent)).toEqual(toolNames(ctx, parent.agent))
      expect(child.agent.session.header.agentPreset).toBe('minimal')
    } finally {
      await child.dispose()
      await parent.dispose()
    }
  })
})

describe('a launcher that configures no writable root', () => {
  // The claim this default exists for, asserted through the real shipped
  // bundles rather than a hand-built context: `apps/cli` patches in only the
  // system root, and a person's own presets are found anyway because the
  // roster derives `<dshHome>/.agent-presets` itself. `$DSH_HOME` is pointed
  // at a temp home BEFORE boot — the derived root is resolved when the plugin
  // is constructed, and an unpinned run would read the developer's own.
  let derivedCtx: Context
  let previousHome: string | undefined

  beforeAll(async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-preset-derived-'))
    previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    await mkdir(join(home, '.agent-presets', 'derived-mine'), { recursive: true })
    await writeFile(
      join(home, '.agent-presets', 'derived-mine', 'agent.cordis.yml'),
      '- id: tool-todo\n  name: \'@deepseek-ai/dsh-tool-todo\'\n  config:\n    allowParallelInProgress: true\n',
    )
    const settingsFile = join(await mkdtemp(join(tmpdir(), 'dsh-preset-derived-settings-')), 'settings.yaml')
    await writeFile(settingsFile, '{}\n')
    // No configured roots: the shipped one is the plugin's own, and the
    // writable one is the roster's own default rather than this patch's job.
    derivedCtx = await bootWeb(settingsFile, [{
      id: 'agent-presets',
      config: { default: 'standard', includeUserRoot: true },
    }])
  }, 120_000)

  afterAll(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await derivedCtx.fiber.dispose()
  })

  it('discovers and mounts a preset the person authored under the harness home', async () => {
    const listed = await derivedCtx.agentPresets.list()

    const mine = listed.find(preset => preset.id === 'derived-mine')
    expect(mine).toMatchObject({ trust: 'user' })
    // Omitted rather than undefined: a healthy row carries no `broken` key.
    expect(mine?.broken).toBeUndefined()
    expect(derivedCtx.agentPresets.authorable).toBe(true)

    const handle = await derivedCtx.agents.create({
      sessionId: SessionId('preset-derived-root'),
      setup: agentCtx => derivedCtx.agentPresets.mount(agentCtx, 'derived-mine').then(() => undefined),
    })
    try {
      expect(toolNames(derivedCtx, handle.agent)).toContain('todo_write')
    } finally {
      await handle.dispose()
    }
  })
})

describe('authoring a preset on the shipped composition', () => {
  let authorCtx: Context
  let userRoot: string

  beforeAll(async () => {
    userRoot = join(await mkdtemp(join(tmpdir(), 'dsh-preset-authoring-')), 'profiles')
    const settingsFile = join(await mkdtemp(join(tmpdir(), 'dsh-preset-authoring-settings-')), 'settings.yaml')
    await writeFile(settingsFile, '{}\n')
    authorCtx = await bootWeb(settingsFile, [{
      id: 'agent-presets',
      config: {
        default: 'standard',
        // The root does not exist yet: a deployment whose user has authored
        // nothing is the normal first-run state. The shipped root is the
        // plugin's own, prepended before this.
        roots: [{ path: userRoot, trust: 'user' }],
        includeUserRoot: false,
      },
    }])
  })

  it('refuses to copy over or delete a shipped preset', async () => {
    await expect(authorCtx.agentPresets.copy('minimal', 'standard')).rejects.toThrow(/already exists/)
    await expect(authorCtx.agentPresets.remove('standard')).rejects.toThrow(/ships with the deployment/)
  })

  it.each(['../escape', 'a/b', '/abs', 'Upper'])('refuses the uncontainable id %j', async (id) => {
    // The id becomes a directory name under the user root, so containment is
    // checked on the id rather than on the joined path afterwards.
    await expect(authorCtx.agentPresets.copy('minimal', id)).rejects.toThrow()
  })

  it('copies a shipped preset a session then really composes from', async () => {
    await authorCtx.agentPresets.copy('minimal', 'my-agent', '我的模式')

    // Round-trips through the roster as a `user` row carrying the given name
    // and the source's description, over the source's own composition text.
    const preset = await authorCtx.agentPresets.resolve('my-agent')
    const source = await authorCtx.agentPresets.resolve('minimal')
    expect(preset.trust).toBe('user')
    expect(preset.name).toBe('我的模式')
    expect(preset.description).toBe(source.description)
    expect(await authorCtx.agentPresets.read('my-agent')).toBe(await authorCtx.agentPresets.read('minimal'))
    // Owner-only, in an owner-only directory: a composition is executable
    // configuration on a machine that may have other users.
    expect((await stat(preset.path)).mode & 0o777).toBe(0o600)
    const handle = await authorCtx.agents.create({
      sessionId: SessionId('preset-authored'),
      setup: agentCtx => authorCtx.agentPresets.mount(agentCtx, 'my-agent').then(() => undefined),
    })
    try {
      // The same tools the shipped `minimal` composes, from a directory copied
      // through the service into a root outside the installed harness.
      expect(toolNames(authorCtx, handle.agent)).toEqual(['bash'])
    } finally {
      await handle.dispose()
    }
  })

  it('deletes what it copied', async () => {
    await authorCtx.agentPresets.copy('minimal', 'doomed')

    await authorCtx.agentPresets.remove('doomed')

    expect((await authorCtx.agentPresets.list()).map(preset => preset.id)).not.toContain('doomed')
  })
})

/**
 * Which preset an unnamed session gets is a user setting layered over the
 * composition's own default. The package suite proves the layering against a
 * hand-built context; this proves it through the shipped `cordis.yml` — that
 * the roster and the settings provider are actually wired to each other, and
 * that the id the setting names is the one a session composes from.
 */
describe('the default preset as a user setting', () => {
  it('composes an unnamed session from the stored default, not the composed one', async () => {
    expect((await ctx.agentPresets.remoteExportList()).modeSelectionEnabled).toBe(true)
    expect(ctx.agentPresets.defaultId).toBe('standard')

    await ctx.settings.update(SETTINGS_NAMESPACE, { default: 'minimal' })
    try {
      expect(ctx.agentPresets.defaultId).toBe('minimal')

      const handle = await ctx.agents.create({
        sessionId: SessionId('preset-user-default'),
        setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
      })
      try {
        // `mount()` with no id resolves the effective default. One tool, not
        // `standard`'s catalog: the setting decided the composition.
        expect(toolNames(ctx, handle.agent)).toEqual(['bash'])
      } finally {
        await handle.dispose()
      }
    } finally {
      // The context is shared with the rest of the file. `replace({})` drops
      // the user section wholesale so the field re-inherits the composition
      // base; `update` merges, and would leave the override standing.
      await ctx.settings.replace(SETTINGS_NAMESPACE, {})
    }

    expect(ctx.agentPresets.defaultId).toBe('standard')
  })
})

describe('a session keeps the preset it was created with', () => {
  it('refuses to adopt a live session under a different preset', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-locked'),
      meta: { agentPreset: 'minimal' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
    try {
      // The api-proxy guard reads exactly this: the header records what the
      // session runs, so naming anything else is a caller error rather than a
      // switch. Its history was produced under `minimal`'s single tool.
      expect(handle.agent.session.header.agentPreset).toBe('minimal')
    } finally {
      await handle.dispose()
    }
  })
})

describe('a composition that configures its own preset roots', () => {
  let rootsCtx: Context
  let teamRoot: string

  beforeAll(async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-preset-roots-'))
    const settingsFile = join(home, 'settings.yaml')
    await writeFile(settingsFile, '{}\n')
    // A workspace-shared root beside the deployment: one preset of its own,
    // plus a directory that claims a shipped id.
    teamRoot = join(home, 'team-presets')
    const minimalComposition = await readFile(join(SHIPPED_PRESET_ROOT, 'minimal', 'agent.cordis.yml'), 'utf8')
    for (const id of ['team-spec', 'minimal']) {
      await mkdir(join(teamRoot, id), { recursive: true })
      await writeFile(join(teamRoot, id, 'agent.cordis.yml'), minimalComposition)
    }
    // The user layer of the reported regression: a profile's cordis.patch.yml
    // configuring a shared preset root. The plugin must EXTEND it with its
    // own shipped root, never lose it.
    rootsCtx = await bootWeb(settingsFile, [{
      id: 'agent-presets',
      config: {
        default: 'standard',
        roots: [{ path: teamRoot, trust: 'user' }],
        includeUserRoot: false,
      },
    }])
  }, 120_000)

  afterAll(async () => {
    await rootsCtx.fiber.dispose()
  })

  it('keeps configured roots alongside the always-prepended shipped root', async () => {
    expect(rootsCtx.agentPresets.roots.map(root => root.path)).toEqual([
      SHIPPED_PRESET_ROOT,
      teamRoot,
    ])

    const listed = await rootsCtx.agentPresets.list()
    expect(listed.map(preset => preset.id).sort()).toEqual(['cordis', 'diaosi', 'minimal', 'ptc', 'standard', 'team-spec'])
    expect(listed.every(preset => preset.broken === undefined)).toBe(true)
    // The shipped root comes first: a configured directory claiming a shipped
    // id is shadowed, never the other way around.
    expect(listed.find(preset => preset.id === 'minimal')?.trust).toBe('system')
    expect(listed.find(preset => preset.id === 'team-spec')?.trust).toBe('user')
  })

  it('composes an agent from a configured-root preset', async () => {
    const handle = await rootsCtx.agents.create({
      sessionId: SessionId('preset-team-spec'),
      setup: agentCtx => rootsCtx.agentPresets.mount(agentCtx, 'team-spec').then(() => undefined),
    })
    try {
      expect(toolNames(rootsCtx, handle.agent)).toEqual(['bash'])
    } finally {
      await handle.dispose()
    }
  })
})
