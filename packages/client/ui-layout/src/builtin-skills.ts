/** Built-in Skill identities and localized instructions used by both runtime and catalog. */
import type { SkillCategory } from './authoring-settings.ts'
import type { LayoutKey } from './client/locales.ts'

export const BUILTIN_SKILLS: readonly {
  name: string
  category: SkillCategory
  title: LayoutKey
  description: LayoutKey
  body: LayoutKey
  steps: readonly LayoutKey[]
}[] = [
  {
    name: 'make-skill', category: 'creation', title: 'builtin.skill.title',
    description: 'builtin.skill.description', body: 'builtin.skill.body',
    steps: ['builtin.skill.step1', 'builtin.skill.step2', 'builtin.skill.step3'],
  },
  {
    name: 'make-workflow', category: 'workflow', title: 'builtin.workflow.title',
    description: 'builtin.workflow.description', body: 'builtin.workflow.body',
    steps: ['builtin.workflow.step1', 'builtin.workflow.step2', 'builtin.workflow.step3'],
  },
]

/** @param id - Saved authoring identity. @returns Registered Skill invocation name. */
export function userSkillName(id: string): string {
  const stableId = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  return `user-${stableId.replace(/^-+|-+$/g, '') || 'skill'}`
}
