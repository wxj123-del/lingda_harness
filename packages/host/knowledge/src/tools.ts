import { z } from 'zod'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { KnowledgeGateway } from './index.ts'

/** Model-facing retrieval tools. Results retain the source excerpt and score. */
export function knowledgeTools(service: KnowledgeGateway): ToolDefinition[] {
  const output: ToolDefinition['output'] = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args: unknown, value: unknown) => [
      { type: 'text' as const, text: JSON.stringify(value) },
    ],
  }
  return [
    {
      name: 'knowledge_list',
      description: '列出已启用的知识库及索引状态。检索前可用它查找知识库 ID。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output,
      execute: async (_args, exec) => {
        exec.signal.throwIfAborted()
        return {
          bases: (await service.overview()).bases
            .filter(base => base.enabled)
            .map(base => ({
              id: base.id,
              title: base.title,
              description: base.description,
              status: base.index.status,
            })),
        }
      },
    },
    {
      name: 'knowledge_search',
      description:
        '检索用户启用的知识库，返回相关原文、文档标题、片段编号和余弦相似度。引用资料时注明知识库和文档标题；相似度不是正确率。未建索引的知识库会列在 skippedBases 中。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '需要查找的问题或内容。' },
          baseId: { type: 'string', description: '可选知识库 ID，省略则检索所有已启用知识库。' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output,
      execute: async (args, exec) => {
        const input = z.object({ query: z.string(), baseId: z.string().optional() }).parse(args)
        return service.search(input.query, input.baseId ?? '', exec.signal)
      },
    },
  ]
}
