import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AttachmentLocal from '@deepseek-ai/dsh-attachment-local'
import CredentialLocal from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as ImagePlugin from '../src/index.ts'
import * as SpeechPlugin from '@deepseek-ai/dsh-speech-generation'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'
const mp3 = Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0])
let context: Context | undefined
let root: string | undefined
let server: ReturnType<typeof createServer> | undefined
afterEach(async () => {
  await context?.fiber.dispose()
  if (server) await new Promise<void>((resolve, reject) => { server!.closeAllConnections(); server!.close(error => error ? reject(error) : resolve()) })
  if (root) await rm(root, { recursive: true, force: true })
  context = undefined; root = undefined; server = undefined
})

class GenerationModel extends LlmAdapter {
  requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const tool = this.requests.length === 1 ? 'generate_image' : this.requests.length === 2 ? 'generate_speech' : undefined
    if (tool) {
      const id = ToolCallId(tool)
      const args = JSON.stringify(tool === 'generate_image' ? { prompt: 'A red square' } : { text: 'Hello' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Media saved.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Media saved.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it('boots both plugins through Loader, runs a real agent turn, saves assets, and unloads tools', { timeout: 60_000 }, async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-media-loader-'))
  const auth: (string | undefined)[] = []
  server = createServer((request, response) => {
    auth.push(request.headers.authorization)
    request.resume()
    if (request.url === '/v1/images/generations') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [{ b64_json: png }], usage: { input_tokens: 3, output_tokens: 5 }, request_id: 'image-request' }))
    } else if (request.url === '/v1/audio/speech') {
      response.setHeader('content-type', 'audio/mpeg')
      response.end(mp3)
    } else { response.writeHead(404).end() }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  const baseURL = 'http://127.0.0.1:' + address.port + '/v1'
  const modules = new Map<string, unknown>([
    ['llm', LlmRuntime], ['sessions', SessionStore], ['projections', SessionProjectionRegistry],
    ['prompt', SystemPrompt], ['tools', ToolRuntime], ['agents', AgentRegistry], ['loop', AgentLoop],
    ['attachments', AttachmentLocal], ['credentials', CredentialLocal], ['image-generation', ImagePlugin], ['speech-generation', SpeechPlugin],
  ])
  const keyRef = credentialRef('DSH_MEDIA_FIXTURE_API_KEY')
  const rows = [...modules.keys()].map(name => ({
    id: name, name,
    config: name === 'attachments' ? { dshHome: root }
      : name === 'credentials' ? { path: join(root!, 'credentials.json'), watch: false }
        : name === 'image-generation' ? { providers: { test: { api: 'openai-images', baseURL, apiKeyEnv: keyRef, models: [{ id: 'gpt-image-2', capabilities: ['text-to-image', 'image-edit'] }] } } }
          : name === 'speech-generation' ? { providers: { test: { api: 'openai-speech', baseURL, apiKeyEnv: keyRef, models: [{ id: 'tts-model', capabilities: ['text-to-speech'], defaultVoice: 'alloy' }] } } }
            : {},
  }))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify(rows))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(name: string) {
    if (!modules.has(name)) throw new Error('Unexpected module: ' + name)
    return modules.get(name)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  await ctx.credentials.set(keyRef, 'test-key-1')
  const model = new GenerationModel()
  ctx.llm.registerAdapter(['fixture'], model)
  const agent = await ctx.agentLoop.create(SessionId('generated-media'), { provider: 'fixture', model: 'fixture' }, { cwd: root })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Generate an image and speech.' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
  expect(results).toHaveLength(2)
  const blocks = results.map(event => event.data.message.content[0]!)
  expect(blocks.map(block => block.type === 'tool-result' && !!block.isError)).toEqual([false, false])
  const contents = blocks.map((block) => {
    if (block.type !== 'tool-result') throw new Error('Missing tool result block')
    return block.content
  })
  const imageResult = contents[0]!.find(part => part.type === 'image')
  const audioResult = contents[1]!.find(part => part.type === 'file')
  if (imageResult?.type !== 'image' || audioResult?.type !== 'file') throw new Error(JSON.stringify(results))
  expect((await ctx.attachments.readImage(imageResult.attachment)).data.length).toBeGreaterThan(0)
  const audioPath = ctx.attachments.fileHostPath(audioResult.attachment)
  expect(await readFile(audioPath!)).toEqual(mp3)
  expect(contents.map(content => content.map(part => part.type))).toMatchInlineSnapshot(`
    [
      [
        "text",
        "image",
        "file",
      ],
      [
        "text",
        "file",
      ],
    ]
  `)
  expect(results[0]!.data.meta).toMatchObject({ model: 'gpt-image-2', usage: { input_tokens: 3, output_tokens: 5 } })
  expect(results[1]!.data.meta).toMatchObject({ usage: null })
  expect(JSON.stringify(agent.session.snapshotEvents())).not.toContain(png)
  expect(JSON.stringify(agent.session.snapshotEvents())).not.toContain('test-key-1')
  expect(model.requests).toHaveLength(3)
  expect(auth).toEqual(['Bearer test-key-1', 'Bearer test-key-1'])
  await ctx.credentials.set(keyRef, 'test-key-2')
  const again = await ctx.tools.execute({ name: 'generate_speech', arguments: { text: 'Again' }, callId: ToolCallId('again'), signal: new AbortController().signal, agent })
  expect(again.isError).toBe(false)
  expect(auth.at(-1)).toBe('Bearer test-key-2')
  for (const id of ['image-generation', 'speech-generation']) {
    const entry = [...ctx.loader.entries()].find(item => item.options.id === id)
    expect(entry?.fiber).toBeDefined()
    await entry!.fiber!.dispose()
  }
  for (const name of ['generate_image', 'list_image_models', 'generate_speech', 'list_speech_models']) expect(ctx.tools.get(name)).toBeUndefined()
})
