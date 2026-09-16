/** Speech route validation and one-call deadlines. */
import type { Context } from '@deepseek-ai/cordis'
import { accounting, catalog, selectRoute, transport, validateConfig, validateInput } from '@deepseek-ai/dsh-generation-core'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { speechAdapters } from './adapters.ts'
import type { AudioFormat, SpeechGenerationConfig, SpeechGenerationRequest, SpeechGenerationResult } from './types.ts'

const mediaTypes: Record<AudioFormat, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac' }

/** Media filename extensions must describe the actual provider bytes. */
function verifyAudio(data: Uint8Array, format: AudioFormat): void {
  const b = Buffer.from(data)
  const text = b.toString('ascii', 0, 12)
  const matches = format === 'wav' ? text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE'
    : format === 'flac' ? text.startsWith('fLaC')
      : format === 'opus' ? text.startsWith('OggS')
        : format === 'mp3' ? text.startsWith('ID3') || b[0] === 255 && (b[1]! & 224) === 224
          : b[0] === 255 && (b[1]! & 246) === 240
  if (!matches) throw new Error('Speech provider bytes do not match requested format ' + format)
}

/** Speech generation does not mutate agent history or retry billable calls. */
export class SpeechGenerationRuntime {
  constructor(private readonly ctx: Context, readonly config: SpeechGenerationConfig) {
    validateConfig(config, Object.keys(speechAdapters), ['text-to-speech'])
  }
  /** Return model capabilities without credential or endpoint details. */
  catalog() { return catalog(this.config) }

  /** Generate one audio file, with provider usage left unknown when absent. */
  async generate(request: SpeechGenerationRequest, signal?: AbortSignal): Promise<SpeechGenerationResult> {
    using d = deadline(signal, this.config.timeoutMs ?? 180_000, 'SPEECH_GENERATION_TIMEOUT')
    d.signal.throwIfAborted()
    validateInput(request.text, this.config.maxInputChars ?? 32_000)
    if (request.instructions) validateInput(request.instructions, this.config.maxInputChars ?? 32_000)
    const route = selectRoute(this.config, request)
    const voice = request.voice ?? route.model.defaultVoice
    if (!voice?.trim()) throw new Error('Provide voice or configure model.defaultVoice')
    if (route.model.voices?.length && !route.model.voices.includes(voice)) throw new Error('Voice is not configured for this model')
    const format = request.format ?? route.model.defaultFormat ?? (route.api === 'gemini' || route.api === 'dashscope' ? 'wav' : 'mp3')
    if (!(format in mediaTypes)) throw new Error('Unsupported audio format')
    if (route.model.formats?.length && !route.model.formats.includes(format)) throw new Error('Format is not configured for this model')
    if ((route.api === 'gemini' || route.api === 'dashscope') && format !== 'wav') throw new Error('This speech API returns WAV only')
    if (request.speed !== undefined && (!Number.isFinite(request.speed) || request.speed < 0.25 || request.speed > 4)) throw new Error('speed must be between 0.25 and 4')
    if (request.speed !== undefined && (route.api === 'gemini' || route.api === 'dashscope' || route.api === 'dashscope-tts')) throw new Error('This speech API does not support speed')
    const adapter = speechAdapters[route.api]
    if (!adapter) throw new Error('Unsupported speech API')
    const started = Date.now()
    const http = await transport(this.ctx, route, this.config, d.signal)
    const audioFormat = format as AudioFormat
    const result = await adapter({ ...request, voice, format: audioFormat }, route, http)
    d.signal.throwIfAborted()
    verifyAudio(result.data, audioFormat)
    return { data: result.data, mediaType: mediaTypes[audioFormat], format: audioFormat, model: route.model.id, provider: route.providerId, elapsedMs: Date.now() - started, ...accounting(result.body) }
  }
}
