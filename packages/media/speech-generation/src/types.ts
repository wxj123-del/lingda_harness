/** Provider-independent speech requests and generated audio. */
import type { MediaAccounting, MediaConfig, MediaRoute, MediaTransport } from '@deepseek-ai/dsh-generation-core'
export type SpeechGenerationConfig = MediaConfig
export type AudioFormat = 'mp3' | 'wav' | 'opus' | 'flac' | 'aac'
export interface SpeechGenerationRequest {
  text: string
  provider?: string
  model?: string
  voice?: string
  format?: AudioFormat
  speed?: number
  instructions?: string
}
export interface SpeechSpec extends SpeechGenerationRequest { voice: string; format: AudioFormat }
export interface SpeechGenerationResult extends MediaAccounting {
  data: Uint8Array
  mediaType: string
  format: AudioFormat
  model: string
  provider: string
  elapsedMs: number
}
export type SpeechAdapter = (request: SpeechSpec, route: MediaRoute, http: MediaTransport) => Promise<{ data: Uint8Array; body: Record<string, unknown> }>
