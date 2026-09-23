/** Host loader entry for the browser-only layout plugin. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { WorkflowEngine, WorkflowResult } from '@deepseek-ai/dsh-workflow'
import { AUTHORING_SETTINGS_NAMESPACE, AuthoringSettingsSchema } from './authoring-settings.ts'
import { releasedWorkflow, type AuthoringItem, type AuthoringSettings } from './authoring-settings.ts'
import { BUILTIN_SKILLS, userSkillName } from './builtin-skills.ts'
import { en } from './client/locales.ts'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { materializeSkillArchive } from './skill-archive-resources.ts'
import { runtimeToolName } from './runtime-tool-name.ts'
import { compileWorkflow } from './workflow-compile.ts'

export { AUTHORING_SETTINGS_NAMESPACE, AuthoringSettingsSchema }
export { isWorkflowPublished, latestWorkflowVersion, releasedWorkflow } from './authoring-settings.ts'
export type { AuthoringItem, AuthoringSettings, WorkflowVersion } from './authoring-settings.ts'

function runtimeSkillContent(item: AuthoringItem): string {
  const steps = item.steps.filter(step => step.trim() !== '').map((step, index) => `${index + 1}. ${step.trim()}`)
  return [item.body.trim(), steps.join('\n')].filter(Boolean).join('\n\n') || item.description.trim()
}

function instructionValue(item: AuthoringItem, input: unknown): { instructions: string } {
  return {
    instructions: [item.body.trim(), ...item.steps.filter(step => step.trim() !== '').map((step, index) => `${index + 1}. ${step.trim()}`), String(input ?? '').trim()]
      .filter(Boolean).join('\n'),
  }
}

function renderWorkflowValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const rendered = JSON.stringify(value, null, 2)
    return rendered === undefined ? String(value) : rendered
  } catch {
    return String(value)
  }
}

async function executeWorkflow(
  item: AuthoringItem,
  input: unknown,
  exec: ToolRunContext,
  workflowEngine: WorkflowEngine | undefined,
): Promise<{ instructions: string }> {
  const compiled = compileWorkflow(item)
  if (compiled === undefined || workflowEngine === undefined || exec.agent === undefined) return instructionValue(item, input)
  const run = workflowEngine.start({
    script: compiled.script,
    meta: compiled.meta,
    args: { input },
    parent: exec.agent,
    nodeAudit: true,
    signal: exec.signal,
  })
  const onAbort = (): void => { run.cancel('parent step aborted') }
  exec.signal.addEventListener('abort', onAbort, { once: true })
  let result: WorkflowResult | undefined
  try {
    result = await run.result
    if (result.stopReason !== 'completed') throw new Error(result.error ?? `workflow stopped with reason: ${result.stopReason}`)
    return { instructions: renderWorkflowValue(result.value) }
  } finally {
    exec.signal.removeEventListener('abort', onAbort)
    await run.dispose()
  }
}

function instructionTool(kind: 'workflow' | 'tool', item: AuthoringItem, workflowEngine: () => WorkflowEngine | undefined): ToolDefinition {
  return {
    name: runtimeToolName(kind, item),
    description: item.description || item.title,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { input: { type: 'string', description: 'Optional input for this user-created plugin.' } },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { instructions: { type: 'string' } }, required: ['instructions'] },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args, exec) => {
      const input = (args as { input?: unknown }).input
      return kind === 'workflow' ? executeWorkflow(item, input, exec, workflowEngine()) : instructionValue(item, input)
    },
  }
}

/** Register the durable Skill/workflow/tool authoring document. */
export function apply(ctx?: Context): void {
  if (ctx === undefined) return
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings.register(AUTHORING_SETTINGS_NAMESPACE, AuthoringSettingsSchema)
    settingsCtx.inject(['skills'], (runtimeCtx) => {
      let disposers: (() => void)[] = []
      let invalidateImports = () => {}
      const temporaryHome = join(tmpdir(), `dsh-${randomUUID()}`)
      runtimeCtx.skills.registerProvider((control) => {
        invalidateImports = control.invalidate
        return {
          name: 'ui-imported-skills',
          list: async () => settings.get().skills.filter(item => item.enabled && item.archive !== undefined).map(item => ({
            name: userSkillName(item.id), description: [item.title, item.description].filter(Boolean).join(': '),
            source: 'custom' as const, provider: 'ui-imported-skills', rank: 250, locator: item.id,
            invocation: item.invocation ?? { modelInvocable: true, userInvocable: true },
          })),
          get: async (candidate, options) => {
            const item = settings.get().skills.find(item => item.id === candidate.locator && item.enabled)
            if (item?.archive === undefined) return undefined
            options.signal?.throwIfAborted()
            const documentPath = runtimeCtx.settings.documentPath
            const directory = await materializeSkillArchive(
              item.archive,
              documentPath === undefined ? temporaryHome : dirname(documentPath),
            )
            options.signal?.throwIfAborted()
            control.signal.throwIfAborted()
            return { ...candidate, content: runtimeSkillContent(item), resourceBase: { kind: 'directory', path: directory } }
          },
        }
      })
      const builtinDisposers = BUILTIN_SKILLS.map(skill => runtimeCtx.skills.register({
        name: skill.name,
        description: en[skill.description],
        source: 'bundled',
        content: [en[skill.body], ...skill.steps.map((key, index) => `${index + 1}. ${en[key]}`)].join('\n\n'),
      }))
      const syncSkills = (value: AuthoringSettings): void => {
        for (const dispose of disposers) dispose()
        disposers = value.skills.filter(item => item.enabled && item.archive === undefined).map(item => runtimeCtx.skills.register({
          name: userSkillName(item.id),
          description: [item.title, item.description].filter(Boolean).join(': '),
          content: runtimeSkillContent(item),
          source: 'custom',
          ...item.invocation === undefined ? {} : { invocation: item.invocation },
        }))
        invalidateImports()
      }
      syncSkills(settings.get())
      runtimeCtx.effect(() => {
        const stop = settings.watch((next) => { syncSkills(next) })
        return () => {
          stop()
          for (const dispose of disposers) dispose()
          for (const dispose of builtinDisposers) dispose()
          disposers = []
        }
      }, 'ui-layout: user skill runtime registrations')
    })
    settingsCtx.inject(['tools'], (runtimeCtx) => {
      let disposers: (() => void)[] = []
      const syncTools = (value: AuthoringSettings): void => {
        for (const dispose of disposers) dispose()
        const workflowEngine = (): WorkflowEngine | undefined => runtimeCtx.get('workflowEngine')
        disposers = [
          // Drafts remain registered so the editor's "Save and test" path can execute them;
          // the catalog keeps draft workflows out of the normal "Use in chat" action.
          ...value.workflows.flatMap((item) => {
            const release = item.enabled ? releasedWorkflow(item) : undefined
            return release === undefined ? [] : [runtimeCtx.tools.register(instructionTool('workflow', release, workflowEngine))]
          }),
          ...value.tools.filter(item => item.enabled).map(item => runtimeCtx.tools.register(instructionTool('tool', item, workflowEngine))),
        ]
      }
      syncTools(settings.get())
      runtimeCtx.effect(() => {
        const stop = settings.watch((next) => { syncTools(next) })
        return () => {
          stop()
          for (const dispose of disposers) dispose()
          disposers = []
        }
      }, 'ui-layout: user tool runtime registrations')
    })
  })
}
