import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechGenerationRuntime } from '../src/runtime.ts'
import { pcmWav } from '../src/adapters.ts'

afterEach(() => vi.unstubAllGlobals())
const wav = pcmWav(Uint8Array.of(0, 0, 1, 0), 24000)
const mp3 = Uint8Array.of(73, 68, 51, 4, 0, 0, 0, 0, 0, 0)
function runtime(api = 'openai-speech') {
  return new SpeechGenerationRuntime(new Context(), {
    providers: { test: { api, anonymous: true, baseURL: 'https://speech.example/v1',
      models: [{ id: 'tts-model', capabilities: ['text-to-speech'], defaultVoice: 'Kore' }] } },
  })
}
describe('speech generation', () => {
  it('passes voice, format, speed and instructions to OpenAI Speech', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(Buffer.from(wav), { headers: { 'content-type': 'audio/wav' } }))
    vi.stubGlobal('fetch', fetcher)
    const value = await runtime().generate({ text: 'Hello', voice: 'alloy', format: 'wav', speed: 1.2, instructions: 'Speak calmly' })
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ model: 'tts-model', input: 'Hello', voice: 'alloy', response_format: 'wav', speed: 1.2, instructions: 'Speak calmly' })
    expect(value).toMatchObject({ mediaType: 'audio/wav', format: 'wav', usage: null })
  })
  it('downloads DashScope WAV without relabeling it as MP3', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ output: { audio: { url: 'https://speech.example/result.wav' } }, usage: { characters: 5 } }))
      .mockResolvedValueOnce(new Response(Buffer.from(wav)))
    vi.stubGlobal('fetch', fetcher)
    expect(await runtime('dashscope').generate({ text: 'Hello' })).toMatchObject({ format: 'wav', usage: { characters: 5 } })
    expect(fetcher.mock.calls[1]?.[1].headers).toBeUndefined()
    await expect(runtime('dashscope').generate({ text: 'Hello', format: 'mp3' })).rejects.toThrow('WAV only')
  })
  it('calls Token Plan DashScope TTS and preserves returned MP3 bytes', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(Buffer.from(mp3), { headers: { 'content-type': 'audio/mpeg' } }))
    vi.stubGlobal('fetch', fetcher)
    const value = await runtime('dashscope-tts').generate({ text: 'Hello' })
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://speech.example/v1/services/audio/tts/SpeechSynthesizer')
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ model: 'tts-model', input: { text: 'Hello', voice: 'Kore', format: 'mp3', sample_rate: 24000 } })
    expect(value).toMatchObject({ format: 'mp3', mediaType: 'audio/mpeg', usage: null })
    expect(Buffer.from(value.data)).toEqual(Buffer.from(mp3))
  })
  it('wraps Gemini PCM in WAV with its reported sample rate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'AAABAA==' } }] } }],
      usageMetadata: { totalTokenCount: 9 },
    })))
    const value = await runtime('gemini').generate({ text: 'Hello' })
    expect(value.data).toEqual(wav)
    expect(Buffer.from(value.data).readUInt32LE(24)).toBe(24000)
    expect(value.usage).toEqual({ totalTokenCount: 9 })
  })
  it('rejects unsupported controls before a billable request', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(runtime().generate({ text: ' ' })).rejects.toThrow('Input')
    await expect(runtime().generate({ text: 'test', speed: 9 })).rejects.toThrow('speed')
    await expect(runtime('gemini').generate({ text: 'test', speed: 1 })).rejects.toThrow('does not support speed')
    await expect(runtime('dashscope-tts').generate({ text: 'test', speed: 1 })).rejects.toThrow('does not support speed')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects error JSON and mislabeled audio returned with HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ error: 'bad request' })).mockResolvedValueOnce(new Response('not audio', { headers: { 'content-type': 'audio/wav' } })))
    await expect(runtime().generate({ text: 'test' })).rejects.toThrow('instead of audio')
    await expect(runtime().generate({ text: 'test', format: 'wav' })).rejects.toThrow('do not match')
  })
})
