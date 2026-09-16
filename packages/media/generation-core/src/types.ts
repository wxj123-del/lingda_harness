/** Configuration and transport types shared by the image and speech plugins. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** A user-declared model and its supported inputs; no remote discovery is assumed. */
export interface MediaModel {
  id: string
  capabilities: string[]
  api?: string
  sizes?: string[]
  aspectRatioSizes?: Record<string, string>
  voices?: string[]
  formats?: string[]
  defaultVoice?: string
  defaultFormat?: string
}

/** One subscription endpoint. Keys are resolved from the credential store per call. */
export interface MediaProvider {
  api: string
  baseURL: string
  apiKeyEnv?: string
  anonymous?: boolean
  models: MediaModel[]
  /** Exact CDN hostnames allowed for credential-free result downloads. */
  downloadHosts?: string[]
}

/** Shared plugin configuration. Empty providers keep installation keyless. */
export interface MediaConfig {
  providers?: Record<string, MediaProvider>
  provider?: string
  model?: string
  timeoutMs?: number
  maxResponseBytes?: number
  pollIntervalMs?: number
  maxInputChars?: number
  maxReferenceImages?: number
}

/** Resolved route selected before a generation request is dispatched. */
export interface MediaRoute {
  providerId: string
  provider: MediaProvider
  model: MediaModel
  api: string
}

/** Raw provider-reported accounting. Absence means unknown, never zero. */
export interface MediaAccounting {
  usage: JsonValue
  requestId?: string
}

/** Adapter transport; authentication is never forwarded to result downloads. */
export interface MediaTransport {
  signal: AbortSignal
  maxBytes: number
  pollIntervalMs: number
  json(path: string, body?: unknown, headers?: Record<string, string>): Promise<Record<string, unknown>>
  request(path: string, body: string | FormData, headers?: Record<string, string>): Promise<Response>
  download(url: string): Promise<Uint8Array>
}
