import type { KnowledgeHit } from './types.ts'

const CHARS_PER_TOKEN = 4

/** Approximate the context cost of one returned knowledge hit. */
function estimateHitTokens(hit: KnowledgeHit): number {
  return Math.ceil(JSON.stringify({ title: hit.title, ordinal: hit.ordinal, content: hit.content }).length / CHARS_PER_TOKEN) + 4
}

function duplicateKey(hit: KnowledgeHit): string {
  const content = hit.content.replace(/\s+/gu, ' ').trim()
  return `${hit.documentId}:${hit.ordinal}:${content}`
}

/**
 * Apply retrieval quality and context budgets after vector search.
 *
 * Results are ranked before filtering so a weak duplicate cannot displace a
 * stronger hit. The returned token count is a labelled estimate, not provider
 * usage; the model-facing retrieval message is still bounded by Context Budget.
 * @param candidates - Raw vector-search hits from all selected bases.
 * @param options - Similarity, item-count, and estimated-token limits.
 * @returns Bounded hits and accounting for discarded duplicates and context.
 */
export function selectKnowledgeHits(
  candidates: readonly KnowledgeHit[],
  options: { limit: number; similarityThreshold: number; maxResultTokens: number },
): { hits: KnowledgeHit[]; deduplicatedHits: number; estimatedTokens: number } {
  const ordered = [...candidates].sort((a, b) => b.score - a.score
    || String(a.baseId).localeCompare(String(b.baseId))
    || a.ordinal - b.ordinal)
  const seen = new Set<string>()
  const hits: KnowledgeHit[] = []
  let deduplicatedHits = 0
  let estimatedTokens = 0
  for (const hit of ordered) {
    if (hit.score < options.similarityThreshold) continue
    const key = duplicateKey(hit)
    if (seen.has(key)) {
      deduplicatedHits++
      continue
    }
    seen.add(key)
    if (hits.length >= options.limit) continue
    const cost = estimateHitTokens(hit)
    if (estimatedTokens + cost > options.maxResultTokens) continue
    hits.push(hit)
    estimatedTokens += cost
  }
  return { hits, deduplicatedHits, estimatedTokens }
}
