/** Image requests and adapter results; binary data stays outside session JSON. */
import type { MediaAccounting, MediaConfig, MediaRoute, MediaTransport } from '@deepseek-ai/dsh-generation-core'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

export type ImageGenerationConfig = MediaConfig
export interface ImageGenerationRequest {
  prompt: string
  provider?: string
  model?: string
  size?: string
  aspectRatio?: string
  referenceImages?: string[]
}
export interface ImageGenerationResult extends MediaAccounting {
  provider: string
  model: string
  data: Uint8Array
  mediaType: ImageMediaType
  elapsedMs: number
}
export type ImageAdapter = (request: ImageGenerationRequest, route: MediaRoute, http: MediaTransport) => Promise<{ data: Uint8Array; body: Record<string, unknown> }>
