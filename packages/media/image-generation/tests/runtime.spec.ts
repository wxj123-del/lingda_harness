import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageGenerationRuntime } from '../src/runtime.ts'
import type { MediaConfig } from '@deepseek-ai/dsh-generation-core'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'
const dataUrl = 'data:image/png;base64,' + png
const contexts: Context[] = []
afterEach(async () => { vi.unstubAllGlobals(); for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

function runtime(api = 'openai-images', extra: Partial<MediaConfig> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  return new ImageGenerationRuntime(ctx, {
    providers: { test: { api, baseURL: 'https://media.example/v1', anonymous: true, models: [
      { id: 'gpt-image-2', capabilities: ['text-to-image', 'image-edit'], aspectRatioSizes: { '1:1': '1024x1024' } },
    ] } },
    pollIntervalMs: 1, ...extra,
  })
}
function response(body: unknown) { return Response.json(body) }

describe('image generation adapters', () => {
  it('uses GPT Image defaults, sends size, and keeps provider accounting', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: [{ b64_json: png }], usage: { input_tokens: 11, output_tokens: 22 } }))
    vi.stubGlobal('fetch', fetcher)
    const value = await runtime().generate({ prompt: 'A red square', aspectRatio: '1:1' })
    expect(value).toMatchObject({ provider: 'test', model: 'gpt-image-2', mediaType: 'image/png', usage: { input_tokens: 11, output_tokens: 22 } })
    const request = JSON.parse(fetcher.mock.calls[0]?.[1].body as string)
    expect(request).toEqual({ prompt: 'A red square', model: 'gpt-image-2', n: 1, size: '1024x1024' })
  })
  it('uploads references to the edit endpoint without losing their MIME type', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: [{ b64_json: png }] }))
    vi.stubGlobal('fetch', fetcher)
    await runtime().generate({ prompt: 'Make it green', referenceImages: [dataUrl] })
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://media.example/v1/images/edits')
    const form = fetcher.mock.calls[0]?.[1].body as FormData
    expect(form.get('model')).toBe('gpt-image-2')
    expect((form.get('image[]') as File).type).toBe('image/png')
  })
  it('maps compatible gateways and Volcano JSON references separately', async () => {
    const fetcher = vi.fn().mockImplementation(async () => response({ data: [{ b64_json: png }] }))
    vi.stubGlobal('fetch', fetcher)
    await runtime('openai-compatible').generate({ prompt: 'test' })
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body).response_format).toBe('b64_json')
    await runtime('volcengine').generate({ prompt: 'test', referenceImages: [dataUrl] })
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body).image).toEqual([dataUrl])
  })
  it('polls Wan tasks, retains request ids, and saves returned binary bytes', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ output: { task_id: 'job1', task_status: 'PENDING' } }))
      .mockResolvedValueOnce(response({ output: { task_status: 'RUNNING' } }))
      .mockResolvedValueOnce(response({ output: { task_status: 'SUCCEEDED', results: [{ url: dataUrl }] }, request_id: 'request1' }))
    vi.stubGlobal('fetch', fetcher)
    const value = await runtime('dashscope-async').generate({ prompt: 'test', size: '1024x1024' })
    expect(value.requestId).toBe('request1')
    expect(fetcher.mock.calls[0]?.[1].headers['X-DashScope-Async']).toBe('enable')
    expect(fetcher.mock.calls[2]?.[0]).toBe('https://media.example/v1/tasks/job1')
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body).parameters.size).toBe('1024*1024')
  })
  it('handles synchronous Wan editing and Gemini inline images', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ output: { choices: [{ message: { content: [{ image: dataUrl }] } }] } }))
      .mockResolvedValueOnce(response({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }], usageMetadata: { totalTokenCount: 7 } }))
    vi.stubGlobal('fetch', fetcher)
    await runtime('dashscope').generate({ prompt: 'edit', referenceImages: [dataUrl] })
    const result = await runtime('gemini').generate({ prompt: 'draw', size: '2K', aspectRatio: '16:9', referenceImages: [dataUrl] })
    expect(result.usage).toEqual({ totalTokenCount: 7 })
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body).generationConfig.imageConfig).toEqual({ imageSize: '2K', aspectRatio: '16:9' })
  })
  it.each(['dashscope-result-bj.oss-cn-beijing.aliyuncs.com', 'dashscope-result-sh.oss-cn-shanghai.aliyuncs.com'])('downloads Wan output from configured CDN %s', async (hostname) => {
    const url = `https://${hostname}/result.png?signature=fixture`
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ output: { choices: [{ message: { content: [{ image: url }] } }] }, request_id: 'wan-result' }))
      .mockResolvedValueOnce(new Response(Buffer.from(png, 'base64')))
    vi.stubGlobal('fetch', fetcher)
    const value = await runtime('dashscope', { providers: { ali: {
      api: 'dashscope', baseURL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1', anonymous: true,
      models: [{ id: 'wan2.7-image', capabilities: ['text-to-image'] }], downloadHosts: [hostname],
    } } }).generate({ prompt: 'A red square' })
    expect(value).toMatchObject({ provider: 'ali', model: 'wan2.7-image', mediaType: 'image/png', requestId: 'wan-result', usage: null })
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    expect(fetcher.mock.calls[1]?.[0]).toBe(url)
    expect(fetcher.mock.calls[1]?.[1].headers).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('rejects invalid dimensions, capabilities, blank prompts, and overlarge references before dispatch', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(runtime().generate({ prompt: ' ' })).rejects.toThrow('Input')
    await expect(runtime().generate({ prompt: 'test', size: '1024x1024', aspectRatio: '16:9' })).rejects.toThrow('matching')
    await expect(runtime().generate({ prompt: 'test', referenceImages: ['not-an-image'] })).rejects.toThrow('data URLs')
    await expect(runtime('dashscope-async').generate({ prompt: 'test', referenceImages: [dataUrl] })).rejects.toThrow('text-to-image only')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('returns unknown usage rather than zero, and rejects malformed or blocked output', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ data: [{ b64_json: png }] }))
      .mockResolvedValueOnce(response({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] }))
      .mockResolvedValueOnce(response({ candidates: [] }))
    vi.stubGlobal('fetch', fetcher)
    expect((await runtime().generate({ prompt: 'test' })).usage).toBeNull()
    await expect(runtime().generate({ prompt: 'test' })).rejects.toThrow('raster')
    await expect(runtime('gemini').generate({ prompt: 'test' })).rejects.toThrow('no single image')
  })
  it('cancels already aborted calls without dispatch and terminates hung requests', async () => {
    const fetcher = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    await expect(runtime().generate({ prompt: 'test' }, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(runtime('openai-images', { timeoutMs: 10 }).generate({ prompt: 'test' })).rejects.toThrow('IMAGE_GENERATION_TIMEOUT')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
