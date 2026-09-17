import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { z } from 'zod'
import type { KnowledgeChunk, KnowledgeDocument, SplitOptions } from './types.ts'

export const splitSchema = z
  .object({
    mode: z.enum(['recursive', 'markdown', 'fixed']),
    size: z.number().int().min(64).max(400),
    overlap: z.number().int().min(0).max(200),
  })
  .refine(value => value.overlap < value.size, 'Overlap must be smaller than chunk size')

/** Split locally without invoking the embedding model. Bounds use characters. */
export async function splitDocuments(
  documents: KnowledgeDocument[],
  options: SplitOptions,
): Promise<KnowledgeChunk[]> {
  splitSchema.parse(options)
  const settings = { chunkSize: options.size, chunkOverlap: options.overlap }
  const splitter =
    options.mode === 'markdown'
      ? RecursiveCharacterTextSplitter.fromLanguage('markdown', settings)
      : new RecursiveCharacterTextSplitter({
        ...settings,
        separators:
            options.mode === 'fixed' ? [''] : ['\n\n', '\n', '。', '！', '？', '；', ' ', ''],
      })
  const chunks: KnowledgeChunk[] = []
  for (const document of documents) {
    const texts = await splitter.splitText(document.content)
    for (const [ordinal, content] of texts.entries())
      chunks.push({ documentId: document.id, title: document.title, ordinal, content })
  }
  return chunks
}
