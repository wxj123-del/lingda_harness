/** Provider selection, bounded HTTP, and result accounting for media generation. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { MediaAccounting, MediaConfig, MediaModel, MediaProvider, MediaRoute, MediaTransport } from './types.ts'

export type * from './types.ts'

const modelSchema: z<MediaModel> = z.object({
  id: z.string().required(), capabilities: z.array(z.string()).required(), api: z.string(),
  sizes: z.array(z.string()), aspectRatioSizes: z.dict(z.string()),
  voices: z.array(z.string()), formats: z.array(z.string()),
  defaultVoice: z.string(), defaultFormat: z.string(),
})
const providerSchema: z<MediaProvider> = z.object({
  api: z.string().required(), baseURL: z.string().required(),
  apiKeyEnv: z.string().role('credential-ref'), anonymous: z.boolean().default(false),
  models: z.array(modelSchema).required(), downloadHosts: z.array(z.string()),
})

/** Shared schema accepted by either installable generation plugin. */
export const MediaConfigSchema: z<MediaConfig> = z.object({
  providers: z.dict(providerSchema).default({}), provider: z.string(), model: z.string(),
  timeoutMs: z.number().min(1).max(2_147_483_647).step(1).default(180_000),
  maxResponseBytes: z.number().min(1).step(1).default(32 * 1024 * 1024),
  pollIntervalMs: z.number().min(1).max(60_000).step(1).default(1000),
  maxInputChars: z.number().min(1).step(1).default(32_000),
  maxReferenceImages: z.number().min(1).step(1).default(8),
})

/** Validate self-contained config errors at plugin load, including default routes. */
export function validateConfig(config: MediaConfig, apis: readonly string[], capabilities: readonly string[]): void {
  for (const [id, provider] of Object.entries(config.providers ?? {})) {
    if (!id.trim()) throw new Error('Media provider id must not be blank')
    endpoint(provider.baseURL)
    if (!apis.includes(provider.api)) throw new Error(`Unsupported media API: ${provider.api}`)
    if (!provider.anonymous && !provider.apiKeyEnv) throw new Error(`Provider ${id} requires apiKeyEnv or anonymous: true`)
    if (provider.apiKeyEnv) credentialRef(provider.apiKeyEnv)
    for (const host of provider.downloadHosts ?? []) {
      if (!/^[a-zA-Z0-9.-]+$/u.test(host)) throw new Error('downloadHosts must contain exact hostnames')
    }
    const ids = new Set<string>()
    if (!provider.models.length) throw new Error(`Provider ${id} has no models`)
    for (const model of provider.models) {
      if (!model.id.trim() || ids.has(model.id)) throw new Error(`Duplicate or blank model in ${id}`)
      ids.add(model.id)
      if (model.api && !apis.includes(model.api)) throw new Error(`Unsupported media API: ${model.api}`)
      if (!model.capabilities.length || model.capabilities.some(c => !capabilities.includes(c))) throw new Error(`Unsupported capability on ${id}/${model.id}`)
    }
  }
  if (config.provider !== undefined && !Object.hasOwn(config.providers ?? {}, config.provider)) throw new Error('Configured media provider does not exist')
  if (config.model !== undefined) selectRoute(config, {})
}

/** Select an explicit route, or the only declared candidate; never silently fail over. */
export function selectRoute(config: MediaConfig, request: { provider?: string | undefined; model?: string | undefined }): MediaRoute {
  const providerId = request.provider ?? config.provider
  const modelId = request.model ?? (request.provider === undefined || request.provider === config.provider ? config.model : undefined)
  const providers = Object.entries(config.providers ?? {})
  const routes = providers.flatMap(([id, provider]) => provider.models.map(model => ({ providerId: id, provider, model, api: model.api ?? provider.api })))
    .filter(route => (providerId === undefined || route.providerId === providerId) && (modelId === undefined || route.model.id === modelId))
  if (routes.length !== 1) throw new Error(routes.length === 0
    ? 'No matching media model configured. Configure providers or call the model catalog tool.'
    : 'Multiple media models match. Specify provider and model from the model catalog.')
  return routes[0]!
}

/** Publish only capabilities and selection defaults, never endpoints or credentials. */
export function catalog(config: MediaConfig): JsonValue {
  return Object.entries(config.providers ?? {}).flatMap(([provider, value]) => value.models.map(model => ({
    provider, model: model.id, api: model.api ?? value.api, capabilities: model.capabilities,
    sizes: model.sizes ?? [], aspectRatioSizes: model.aspectRatioSizes ?? {},
    voices: model.voices ?? [], formats: model.formats ?? [],
    defaultVoice: model.defaultVoice ?? null, defaultFormat: model.defaultFormat ?? null,
    selected: config.provider === provider && config.model === model.id,
  })))
}

/** Refuse blank or oversized generation inputs before billable dispatch. */
export function validateInput(text: string, max: number): void {
  if (!text.trim() || text.length > max) throw new Error(`Input must contain 1-${max} characters`)
}

/** Reject unsupported URL schemes, embedded credentials, and query-based secrets. */
function endpoint(value: string): URL {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('baseURL must be an HTTP(S) API base without credentials, query, or fragment')
  return url
}

/** Read a bounded body, cancelling the stream on overflow or failure. */
export async function readBytes(response: Response, max: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Media response body is empty')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > max) throw new Error(`Media response exceeds ${max} bytes`)
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  if (!size) throw new Error('Media response body is empty')
  return Buffer.concat(chunks, size)
}

/** Parse a provider JSON object; never coerce malformed responses into success. */
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid media provider response object')
  return value as Record<string, unknown>
}

/** Decode canonical nonempty base64 with a decoded-byte limit. */
export function decodeBase64(value: string, max: number): Uint8Array {
  if (value.length > Math.ceil(max / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw new Error('Invalid or oversized media base64')
  const data = Buffer.from(value, 'base64')
  if (!data.length || data.length > max || data.toString('base64') !== value) throw new Error('Invalid or oversized media base64')
  return data
}

/** Build per-operation transport after resolving the current credential. */
export async function transport(ctx: Context, route: MediaRoute, config: MediaConfig, signal: AbortSignal): Promise<MediaTransport> {
  signal.throwIfAborted()
  const key = route.provider.apiKeyEnv === undefined ? undefined : (await ctx.get('credentials')?.resolve(credentialRef(route.provider.apiKeyEnv)))?.value
  signal.throwIfAborted()
  if (!key && !route.provider.anonymous) throw new Error(`Provider ${route.providerId} needs credential ${route.provider.apiKeyEnv}`)
  const base = endpoint(route.provider.baseURL).href.replace(/\/$/u, '')
  const auth = key ? route.api === 'gemini' ? { 'x-goog-api-key': key } : { authorization: `Bearer ${key}` } : {}
  const maxBytes = config.maxResponseBytes ?? 32 * 1024 * 1024
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    const response = await fetch(url, { ...init, signal, redirect: 'error' })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Media provider ${route.providerId}: HTTP ${response.status}`)
    }
    return response
  }
  const request: MediaTransport['request'] = (path, body, headers = {}) => send(`${base}${path}`, { method: 'POST', headers: { ...auth, ...(typeof body === 'string' ? { 'content-type': 'application/json' } : {}), ...headers }, body })
  return {
    signal, maxBytes, pollIntervalMs: config.pollIntervalMs ?? 1000, request,
    async json(path, body, headers) {
      const response = body === undefined ? await send(`${base}${path}`, { headers: { ...auth, ...headers } }) : await request(path, JSON.stringify(body), headers)
      return record(JSON.parse(Buffer.from(await readBytes(response, maxBytes)).toString('utf8')))
    },
    async download(value) {
      const url = new URL(value)
      const trusted = url.origin === new URL(base).origin || (route.provider.downloadHosts ?? []).includes(url.hostname)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Result download URL must use HTTP(S) without embedded credentials')
      if (!trusted) throw new Error(`Result download host "${url.hostname}" is not trusted for provider "${route.providerId}"; add this exact hostname to provider.downloadHosts`)
      return readBytes(await send(url.href, {}), maxBytes)
    },
  }
}

/** Keep provider accounting as JSON for durable tool results without inferred costs. */
export function accounting(body: Record<string, unknown>): MediaAccounting {
  const usage = body.usage ?? body.usageMetadata
  const requestId = body.request_id ?? body.id
  return { usage: usage && typeof usage === 'object' ? usage as JsonValue : null, ...(typeof requestId === 'string' ? { requestId } : {}) }
}

/** Shared canonical result fields, reused by generation tools. */
export const resultFields = {
  provider: { type: 'string', required: true }, model: { type: 'string', required: true },
  elapsedMs: { type: 'integer', required: true }, usage: { type: 'json', required: true },
  requestId: { type: 'string' },
} as const
