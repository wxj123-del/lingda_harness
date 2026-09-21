import { describe, expect, it } from 'vitest'
import { selectKnowledgeHits } from '../src/search.ts'
import type { KnowledgeHit } from '../src/types.ts'

const hit = (content: string, score: number, ordinal = 0): KnowledgeHit => ({
  baseId: `base-${ordinal}` as KnowledgeHit['baseId'],
  baseTitle: '测试知识库',
  documentId: `doc-${ordinal}` as KnowledgeHit['documentId'],
  title: '文档', ordinal, content, score,
})

describe('knowledge result budget', () => {
  it('filters weak matches, deduplicates identical excerpts, and caps result tokens', () => {
    const duplicate = hit('相同片段', 0.91, 1)
    const result = selectKnowledgeHits([
      hit('高相关片段', 0.95), duplicate, { ...duplicate, baseId: 'other-base' as KnowledgeHit['baseId'] },
      hit('弱相关片段', 0.2, 3),
    ], { limit: 10, similarityThreshold: 0.35, maxResultTokens: 100 })
    expect(result.hits.map(item => item.content)).toEqual(['高相关片段', '相同片段'])
    expect(result.deduplicatedHits).toBe(1)
    expect(result.estimatedTokens).toBeLessThanOrEqual(100)
  })

  it('uses strongest matches first and respects the item limit', () => {
    const result = selectKnowledgeHits([hit('中', 0.7, 1), hit('高', 0.9, 2), hit('低', 0.4, 3)], {
      limit: 2, similarityThreshold: 0, maxResultTokens: 100,
    })
    expect(result.hits.map(item => item.content)).toEqual(['高', '中'])
  })
})
