/** Speech provider HTTP protocols and Gemini PCM container conversion. */
import { decodeBase64, readBytes, record } from '@deepseek-ai/dsh-generation-core'
import type { SpeechAdapter } from './types.ts'

/** Wrap Gemini's mono signed 16-bit little-endian PCM in a standard WAV container. */
export function pcmWav(data: Uint8Array, rate: number): Uint8Array {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000 || data.length % 2) throw new Error('Invalid Gemini PCM audio')
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(data.length + 36, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const openai: SpeechAdapter = async (request, route, http) => {
  const response = await http.request('/audio/speech', JSON.stringify({
    model: route.model.id, input: request.text, voice: request.voice, response_format: request.format,
    ...(request.speed === undefined ? {} : { speed: request.speed }),
    ...(request.instructions === undefined ? {} : { instructions: request.instructions }),
  }))
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('json') || type.includes('text/')) {
    await response.body?.cancel()
    throw new Error('Speech provider returned text instead of audio')
  }
  return { data: await readBytes(response, http.maxBytes), body: {} }
}

const dashscope: SpeechAdapter = async (request, route, http) => {
  const body = await http.json('/services/aigc/multimodal-generation/generation', {
    model: route.model.id, input: { text: request.text, voice: request.voice,
      ...(request.instructions === undefined ? {} : { instructions: request.instructions }),
    },
  })
  const audio = record(record(body.output).audio)
  if (typeof audio.url !== 'string') throw new Error('DashScope returned no audio URL')
  return { data: await http.download(audio.url), body }
}

/** Token Plan's DashScope-compatible TTS endpoint returns audio bytes directly. */
const dashscopeTts: SpeechAdapter = async (request, route, http) => {
  if (request.instructions !== undefined) throw new Error('This speech API does not support instructions')
  const response = await http.request('/services/audio/tts/SpeechSynthesizer', JSON.stringify({
    model: route.model.id,
    input: { text: request.text, voice: request.voice, format: request.format, sample_rate: 24000 },
  }))
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('json') || type.includes('text/')) {
    await response.body?.cancel()
    throw new Error('Speech provider returned text instead of audio')
  }
  return { data: await readBytes(response, http.maxBytes), body: {} }
}

const gemini: SpeechAdapter = async (request, route, http) => {
  const body = await http.json('/models/' + encodeURIComponent(route.model.id) + ':generateContent', {
    contents: [{ role: 'user', parts: [{ text: request.instructions ? request.instructions + '\n' + request.text : request.text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: request.voice } } } },
  })
  const candidates = body.candidates
  if (!Array.isArray(candidates) || candidates.length !== 1) throw new Error('Gemini returned no single audio candidate')
  const parts = record(record(candidates[0]).content).parts
  const audio = (Array.isArray(parts) ? parts : []).map(record).filter(part => part.inlineData && part.thought !== true)
  if (audio.length !== 1) throw new Error('Gemini returned no single audio part')
  const inline = record(audio[0]!.inlineData)
  if (typeof inline.data !== 'string' || typeof inline.mimeType !== 'string') throw new Error('Invalid Gemini audio data')
  const data = decodeBase64(inline.data, http.maxBytes - 44)
  const rate = /(?:^|;)\s*rate=(\d+)/iu.exec(inline.mimeType)
  if (!inline.mimeType.startsWith('audio/L16') || !rate) throw new Error('Unsupported Gemini audio format; expected audio/L16 with rate')
  return { data: pcmWav(data, Number(rate[1])), body }
}

/** Protocol choices are explicit; unsupported WebSocket APIs are not treated as compatible. */
export const speechAdapters: Readonly<Record<string, SpeechAdapter>> = {
  'openai-speech': openai, 'openai-compatible': openai, dashscope, 'dashscope-tts': dashscopeTts, gemini,
}
