
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import AuthoringAssistantService from '../src/index.ts'

/** LLM service stub whose stream yields one text block holding `reply`. */
function provideLlm(ctx: Context, reply: string, providers: readonly string[] = ['test']): void {
  ctx.provide('llm', {
    listProviders: () => providers.map(id => ({ id })),
    stream: async function* () {
      yield { type: 'text-delta', index: 0, text: reply }
    },
  } as never)
}

async function harness(reply: string, options: { web?: boolean; providers?: readonly string[] } = {}): Promise<Context> {
  const ctx = new Context()
  provideLlm(ctx, reply, options.providers ?? ['test'])
  if (options.web === true) await ctx.plugin(WebRuntime, {})
  await ctx.plugin(AuthoringAssistantService, { provider: 'test', model: 'draft-model' })
  return ctx
}

describe('authoring assistant service', () => {
  it('returns an accepted workflow draft from model JSON', async () => {
    const draft = {
      title: '前端页面',
      description: '生成页面',
      steps: ['规划'],
      nodes: [{ kind: 'start', title: '开始' }, { kind: 'end', title: '结束' }],
      edges: [{ source: 0, target: 1 }],
    }
    const ctx = await harness(`Draft:\n\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``)
    const result = await ctx.authoringAssistant.generateWorkflow(
      { message: '做一个前端工作流' },
      new AbortController().signal,
    )
    expect(result.reply).toBe('Draft:')
    expect(result.draft?.title).toBe('前端页面')
    expect(result.draft?.edges).toHaveLength(1)
  })

  it('keeps the prose when the model returns no usable draft', async () => {
    const ctx = await harness('请问页面需要几个模块？')
    const result = await ctx.authoringAssistant.generateWorkflow(
      { message: '做一个前端工作流' },
      new AbortController().signal,
    )
    expect(result.draft).toBeNull()
    expect(result.reply).toContain('模块')
  })

  it('rejects an empty message', async () => {
    const ctx = await harness('x')
    await expect(ctx.authoringAssistant.generateWorkflow({ message: '  ' }, new AbortController().signal))
      .rejects.toThrow(/message is required/)
  })

  it('reports a missing provider route', async () => {
    const ctx = await harness('x', { providers: [] })
    await expect(ctx.authoringAssistant.generateWorkflow({ message: 'hi' }, new AbortController().signal))
      .rejects.toThrow(/no adapter serves provider/)
  })

  it('drafts a knowledge base and reports fetch failures without failing the turn', async () => {
    const draft = { title: '规范', description: '', documents: [{ title: 'a', content: 'b' }] }
    const ctx = await harness(JSON.stringify(draft))
    const result = await ctx.authoringAssistant.generateKnowledge(
      { message: '整理一份前端规范', urls: ['not-a-url'] },
      new AbortController().signal,
    )
    expect(result.draft?.title).toBe('规范')
    expect(result.sources).toEqual([{ url: 'not-a-url', status: 'failed', detail: 'not an absolute URL' }])
  })

  it('rejects more source URLs than the configured ceiling', async () => {
    const ctx = await harness('{}')
    const urls = Array.from({ length: 9 }, (_, index) => `https://example.com/${String(index)}`)
    await expect(ctx.authoringAssistant.generateKnowledge({ message: 'x', urls }, new AbortController().signal))
      .rejects.toThrow(/at most 8 source URLs/)
  })
})
