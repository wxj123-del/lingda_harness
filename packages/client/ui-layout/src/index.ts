/** Host loader entry for the browser-only layout plugin. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { AUTHORING_SETTINGS_NAMESPACE, AuthoringSettingsSchema } from './authoring-settings.ts'
import type { AuthoringItem, AuthoringSettings } from './authoring-settings.ts'
import { BUILTIN_SKILLS, userSkillName } from './builtin-skills.ts'
import { en } from './client/locales.ts'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { materializeSkillArchive } from './skill-archive-resources.ts'

export { AUTHORING_SETTINGS_NAMESPACE, AuthoringSettingsSchema }
export type { AuthoringItem, AuthoringSettings } from './authoring-settings.ts'

function runtimeSkillContent(item: AuthoringItem): string {
  const steps = item.steps.filter(step => step.trim() !== '').map((step, index) => `${index + 1}. ${step.trim()}`)
  return [item.body.trim(), steps.join('\n')].filter(Boolean).join('\n\n') || item.description.trim()
}

function runtimeToolName(kind: string, item: AuthoringItem): string {
  const stableId = item.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  return `user_${kind}_${stableId.replace(/^-+|-+$/g, '') || 'item'}`
}

function searchKnowledge(item: AuthoringItem, query: string): { title: string; content: string }[] {
  const documents = item.documents?.length === 0 || item.documents === undefined
    ? item.body.trim() === '' ? [] : [{ title: item.title, content: item.body }]
    : item.documents
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return documents
    .map(document => ({ document, score: terms.reduce((score, term) => score + (document.content.toLocaleLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(result => terms.length === 0 || result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ document }) => ({ title: document.title, content: document.content.slice(0, 2_000) }))
}

function knowledgeTool(item: AuthoringItem): ToolDefinition {
  return {
    name: runtimeToolName('knowledge', item),
    description: item.description || `Search the ${item.title} knowledge base.`,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { query: { type: 'string', description: 'Keywords to search for.' } },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          results: {
            type: 'array', items: {
              type: 'object', additionalProperties: false,
              properties: { title: { type: 'string' }, content: { type: 'string' } },
              required: ['title', 'content'],
            },
          },
        },
        required: ['results'],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async args => ({ results: searchKnowledge(item, String((args as { query?: unknown }).query ?? '')) }),
  }
}

function instructionTool(kind: 'workflow' | 'tool', item: AuthoringItem): ToolDefinition {
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
    execute: async args => ({
      instructions: [item.body.trim(), ...item.steps.filter(step => step.trim() !== '').map((step, index) => `${index + 1}. ${step.trim()}`), String((args as { input?: unknown }).input ?? '').trim()]
        .filter(Boolean).join('\n'),
    }),
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
            const directory = await materializeSkillArchive(item.archive, documentPath === undefined ? temporaryHome : dirname(documentPath))
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
        disposers = [
          ...value.knowledge.filter(item => item.enabled).map(item => runtimeCtx.tools.register(knowledgeTool(item))),
          ...value.workflows.filter(item => item.enabled).map(item => runtimeCtx.tools.register(instructionTool('workflow', item))),
          ...value.tools.filter(item => item.enabled).map(item => runtimeCtx.tools.register(instructionTool('tool', item))),
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
