/** Client-safe vocabulary shared by the browser authoring assistant and its Host Remote. */

/** Node kinds the visual workflow editor accepts. Mirrors `WorkflowNodeKind` in ui-layout. */
export const AUTHORING_NODE_KINDS = [
  'start', 'input', 'llm', 'tool', 'knowledge', 'condition', 'code', 'http', 'template', 'output', 'end',
] as const
export type AuthoringNodeKind = typeof AUTHORING_NODE_KINDS[number]

/** One draft workflow node as the model returns it, before the browser assigns canvas positions. */
export interface DraftWorkflowNode {
  kind: AuthoringNodeKind
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
    retries?: number
  }
}

/** One draft connection; `source`/`target` are indices into the returned node list. */
export interface DraftWorkflowEdge {
  source: number
  target: number
  sourceHandle?: 'true' | 'false'
}

/** A workflow draft the model proposed from the conversation. */
export interface WorkflowDraft {
  title: string
  description: string
  /** Ordered execution steps suitable for the workflow card summary. */
  steps: string[]
  nodes: DraftWorkflowNode[]
  edges: DraftWorkflowEdge[]
}

/** One knowledge document proposed by the model or fetched from a source URL. */
export interface DraftKnowledgeDocument {
  title: string
  content: string
  /** Source URL when the material came from the web. */
  source?: string
}

/** A knowledge-base draft the model proposed from the conversation. */
export interface KnowledgeDraft {
  title: string
  description: string
  documents: DraftKnowledgeDocument[]
}

/** One conversation turn the browser replays to the Host. */
export interface AuthoringChatTurn {
  role: 'user' | 'assistant'
  text: string
}

/** Request for one workflow-generation turn. */
export interface WorkflowGenerateRequest {
  /** The user's latest instruction. */
  message: string
  /** Prior turns, oldest first; the Host adds them as context without persisting a Session. */
  history?: AuthoringChatTurn[]
  /** The draft currently being edited, so follow-up turns can refine instead of restart. */
  current?: WorkflowDraft
}

/** Request for one knowledge-generation turn. */
export interface KnowledgeGenerateRequest {
  message: string
  history?: AuthoringChatTurn[]
  /** The draft currently being edited. */
  current?: KnowledgeDraft
  /** Source URLs the user wants fetched into the knowledge base. */
  urls?: string[]
}

/** Result of one workflow-generation turn. */
export interface WorkflowGenerateValue {
  /** Short natural-language reply explaining the draft. */
  reply: string
  draft: WorkflowDraft | null
}

/** Result of one knowledge-generation turn. */
export interface KnowledgeGenerateValue {
  reply: string
  draft: KnowledgeDraft | null
  /** Per-URL retrieval outcome so the user can see what succeeded. */
  sources: Array<{ url: string; status: 'ok' | 'failed'; detail?: string }>
}
