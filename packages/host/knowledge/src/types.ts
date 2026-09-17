import type { Branded } from '@deepseek-ai/dsh-brand'

export type KnowledgeBaseId = Branded<'KnowledgeBaseId'>
export type KnowledgeDocumentId = Branded<'KnowledgeDocumentId'>
export interface SplitOptions {
  mode: 'recursive' | 'markdown' | 'fixed'
  size: number
  overlap: number
}
export interface KnowledgeDocument {
  id: KnowledgeDocumentId
  title: string
  content: string
  updatedAt: number
}
export interface KnowledgeBase {
  id: KnowledgeBaseId
  title: string
  description: string
  enabled: boolean
  split: SplitOptions
  documents: KnowledgeDocument[]
  revision: number
  updatedAt: number
}
export interface KnowledgeBaseDraft {
  id: KnowledgeBaseId
  title: string
  description: string
  enabled: boolean
  split: SplitOptions
  documents: KnowledgeDocument[]
  /** Zero creates; updates must match the stored revision. */
  revision: number
}
export interface IndexStatus {
  status: 'empty' | 'pending' | 'indexing' | 'ready' | 'error'
  chunks: number
  completed: number
  total: number
  error: string | null
}
export interface KnowledgeOverview {
  bases: Array<Omit<KnowledgeBase, 'documents'> & { documentCount: number; index: IndexStatus }>
  model: {
    id: string
    status: 'idle' | 'loading' | 'ready' | 'error'
    file: string
    progress: number
    error: string | null
  }
  defaults: SplitOptions
}
export interface KnowledgeChunk {
  documentId: KnowledgeDocumentId
  title: string
  ordinal: number
  content: string
}
export interface KnowledgeHit extends KnowledgeChunk {
  baseId: KnowledgeBaseId
  baseTitle: string
  /** Cosine similarity, not a calibrated relevance probability. */
  score: number
}
export interface KnowledgeSearch {
  hits: KnowledgeHit[]
  skippedBases: KnowledgeBaseId[]
}
export interface LegacyKnowledgeBase {
  id: string
  title: string
  description: string
  enabled: boolean
  body: string
  documents?: { id: string; title: string; content: string; updatedAt: number }[]
}
