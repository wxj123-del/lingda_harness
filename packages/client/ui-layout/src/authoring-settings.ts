import z from '@deepseek-ai/schemastery'

export const AUTHORING_SETTINGS_NAMESPACE = 'ui-authoring'

/** Discovery categories shared by the Skill editor and catalog. */
export const SKILL_CATEGORIES = ['creation', 'workflow', 'writing', 'research', 'development', 'general'] as const
export type SkillCategory = typeof SKILL_CATEGORIES[number]

export interface KnowledgeDocument {
  id: string
  title: string
  content: string
  updatedAt: number
}

export interface AuthoringItem {
  id: string
  title: string
  description: string
  enabled: boolean
  body: string
  steps: string[]
  documents?: KnowledgeDocument[]
  category?: SkillCategory
  /** Original ZIP retained for referenced scripts and assets. */
  archive?: string
  /** Invocation flags from imported SKILL.md metadata. */
  invocation?: { modelInvocable: boolean; userInvocable: boolean }
  updatedAt: number
}

export interface AuthoringSettings {
  skills: AuthoringItem[]
  workflows: AuthoringItem[]
  tools: AuthoringItem[]
  knowledge: AuthoringItem[]
}

const authoringItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  body: z.string().default(''),
  steps: z.array(z.string()).default([]),
  category: z.union([...SKILL_CATEGORIES]).default('general'),
  archive: z.string().max(2796204),
  invocation: z.object({ modelInvocable: z.boolean(), userInvocable: z.boolean() }),
  documents: z.array(z.object({
    id: z.string(),
    title: z.string(),
    content: z.string().default(''),
    updatedAt: z.number().default(0),
  })).default([]),
  updatedAt: z.number().default(0),
})

export const AuthoringSettingsSchema: z<AuthoringSettings> = z.object({
  skills: z.array(authoringItemSchema).default([]),
  workflows: z.array(authoringItemSchema).default([]),
  tools: z.array(authoringItemSchema).default([]),
  knowledge: z.array(authoringItemSchema).default([]),
})
