/** Validate one image operation, select its adapter, and retain reported accounting. */
import type { Context } from '@deepseek-ai/cordis'
import { accounting, catalog, selectRoute, transport, validateConfig, validateInput } from '@deepseek-ai/dsh-generation-core'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { imageAdapters, imageDataUrl } from './adapters.ts'
import type { ImageGenerationConfig, ImageGenerationRequest, ImageGenerationResult } from './types.ts'

/** Detect a raster signature; the attachment service still performs full validation. */
export function imageMediaType(data: Uint8Array): ImageMediaType {
  const bytes = Buffer.from(data)
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (/^GIF8[79]a$/u.test(bytes.toString('ascii', 0, 6))) return 'image/gif'
  throw new Error('Provider did not return a supported raster image')
}

/** One generation call owns one deadline, including task polling and downloads. */
export class ImageGenerationRuntime {
  constructor(private readonly ctx: Context, readonly config: ImageGenerationConfig) {
    validateConfig(config, Object.keys(imageAdapters), ['text-to-image', 'image-edit'])
  }

  /** Return the secret-free configured capability catalog. */
  catalog() { return catalog(this.config) }

  /** Generate one raster; the tool owns durable saving and display. */
  async generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    using d = deadline(signal, this.config.timeoutMs ?? 180_000, 'IMAGE_GENERATION_TIMEOUT')
    d.signal.throwIfAborted()
    validateInput(request.prompt, this.config.maxInputChars ?? 32_000)
    const route = selectRoute(this.config, request)
    const refs = request.referenceImages ?? []
    const capability = refs.length ? 'image-edit' : 'text-to-image'
    if (!route.model.capabilities.includes(capability)) throw new Error(route.model.id + ' does not support ' + capability)
    if (refs.length > (this.config.maxReferenceImages ?? 8)) throw new Error('Too many reference images')
    const max = this.config.maxResponseBytes ?? 32 * 1024 * 1024
    let total = 0
    for (const ref of refs) total += imageDataUrl(ref, max).data.byteLength
    if (total > max) throw new Error('Reference images exceed the aggregate byte limit')
    if (refs.length && route.api === 'dashscope-async') throw new Error('dashscope-async supports text-to-image only')
    let size = request.size
    if (request.aspectRatio !== undefined) {
      if (!/^[1-9]\d*:[1-9]\d*$/u.test(request.aspectRatio)) throw new Error('aspect_ratio must be width:height')
      if (route.api !== 'gemini') {
        size ??= route.model.aspectRatioSizes?.[request.aspectRatio]
        const dimensions = /^(\d+)[x*](\d+)$/u.exec(size ?? '')
        const [w, h] = request.aspectRatio.split(':').map(Number)
        if (!dimensions || Math.abs(Number(dimensions[1]) / Number(dimensions[2]) - w! / h!) > 0.02) throw new Error('Provide a pixel size matching aspect_ratio, or configure model.aspectRatioSizes')
      }
    }
    if (size && route.model.sizes?.length && !route.model.sizes.includes(size)) throw new Error('Unsupported size for ' + route.model.id)
    const adapter = imageAdapters[route.api]
    if (!adapter) throw new Error('Unsupported image API: ' + route.api)
    const started = Date.now()
    const http = await transport(this.ctx, route, this.config, d.signal)
    const result = await adapter({ ...request, ...(size ? { size } : {}) }, route, http)
    d.signal.throwIfAborted()
    return { data: result.data, mediaType: imageMediaType(result.data), provider: route.providerId, model: route.model.id, elapsedMs: Date.now() - started, ...accounting(result.body) }
  }
}
