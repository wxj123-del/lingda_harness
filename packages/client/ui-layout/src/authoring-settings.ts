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

/** Node kinds available in the visual workflow editor. */
export type WorkflowNodeKind = 'start' | 'input' | 'llm' | 'tool' | 'knowledge' | 'condition' | 'code' | 'http' | 'template' | 'output' | 'end'

/** Persisted visual workflow node position and execution instruction. */
export interface WorkflowNode {
  id: string
  kind: WorkflowNodeKind
  title: string
  instructions: string
  config?: {
    model?: string
    tool?: string
    condition?: string
    output?: string
    variable?: string
    knowledge?: string
    format?: string
    language?: string
    url?: string
    method?: string
    template?: string
  }
  x: number
  y: number
}

/** Directed connection between two visual workflow nodes. */
export interface WorkflowEdge {
  id: string
  source: string
  target: string
  /** Branch selected by a condition node. Edges without a handle are ordinary flow edges. */
  sourceHandle?: 'true' | 'false' | undefined
}

/** Persisted canvas camera, matching the model used by production workflow editors. */
export interface WorkflowViewport {
  x: number
  y: number
  zoom: number
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
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
  viewport?: WorkflowViewport | null
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
  nodes: z.array(z.object({
    id: z.string(),
    kind: z.union(['start', 'input', 'llm', 'tool', 'knowledge', 'condition', 'code', 'http', 'template', 'output', 'end']),
    title: z.string(),
    instructions: z.string().default(''),
    config: z.object({
      model: z.string().default(''), tool: z.string().default(''), condition: z.string().default(''), output: z.string().default(''),
      variable: z.string().default(''), knowledge: z.string().default(''), format: z.string().default(''), language: z.string().default(''), url: z.string().default(''), method: z.string().default('GET'), template: z.string().default(''),
    }),
    x: z.number().default(0),
    y: z.number().default(0),
  })).default([]),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), sourceHandle: z.union(['true', 'false', z.const(undefined)]).default(undefined as never) })).default([]),
  viewport: z.object({ x: z.number().default(0), y: z.number().default(0), zoom: z.number().default(1) }).default(undefined as never),
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
