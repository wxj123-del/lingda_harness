/** Protocol-specific image requests; route selection and limits live in the runtime. */
import { setTimeout } from 'node:timers/promises'
import { decodeBase64, readBytes, record } from '@deepseek-ai/dsh-generation-core'
import type { MediaTransport } from '@deepseek-ai/dsh-generation-core'
import type { ImageAdapter } from './types.ts'

export function imageDataUrl(value: string, max: number): { data: Uint8Array; mimeType: string } {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/u.exec(value)
  if (!match) throw new Error('Reference images must be PNG/JPEG/WebP/GIF data URLs')
  return { mimeType: match[1]!, data: decodeBase64(match[2]!, max) }
}

async function imageValue(value: string, http: MediaTransport): Promise<Uint8Array> { return value.startsWith('data:') ? imageDataUrl(value, http.maxBytes).data : http.download(value) }

async function openaiResult(body: Record<string, unknown>, http: MediaTransport): Promise<{ data: Uint8Array; body: Record<string, unknown> }> {
  const values = body.data
  if (!Array.isArray(values) || values.length !== 1) throw new Error('Image provider must return exactly one image')
  const item = record(values[0])
  const data = typeof item.b64_json === 'string' ? decodeBase64(item.b64_json, http.maxBytes) : typeof item.url === 'string' ? await imageValue(item.url, http) : undefined
  if (!data) throw new Error('Image provider returned no image data')
  return { data, body }
}

/** OpenAI Images and compatible gateways use the same JSON generation endpoint. */
export const openai: ImageAdapter = async (request, route, http) => {
  if (request.referenceImages?.length) {
    const form = new FormData()
    form.set('model', route.model.id)
    form.set('prompt', request.prompt)
    if (request.size) form.set('size', request.size)
    if (route.api === 'openai-compatible') form.set('response_format', 'b64_json')
    for (const [index, value] of request.referenceImages.entries()) {
      const image = imageDataUrl(value, http.maxBytes)
      form.append('image[]', new Blob([Uint8Array.from(image.data)], { type: image.mimeType }), `reference-${index}.${image.mimeType.split('/')[1]}`)
    }
    const response = await http.request('/images/edits', form)
    return openaiResult(record(JSON.parse(Buffer.from(await readBytes(response, http.maxBytes)).toString('utf8'))), http)
  }
  return openaiResult(await http.json('/images/generations', {
    model: route.model.id, prompt: request.prompt, n: 1,
    ...(request.size ? { size: request.size } : {}),
    ...(route.api === 'openai-compatible' ? { response_format: 'b64_json' } : {}),
  }), http)
}

/** Volcano Ark/Seedream accepts the same generation request with optional references. */
export const volcengine: ImageAdapter = async (request, route, http) => openaiResult(await http.json('/images/generations', { model: route.model.id, prompt: request.prompt, response_format: 'b64_json', sequential_image_generation: 'disabled', stream: false, ...(request.size ? { size: request.size } : {}), ...(request.referenceImages?.length ? { image: request.referenceImages } : {}) }), http)

/** Wan multimodal editing and the asynchronous text-to-image task protocol. */
export const dashscope: ImageAdapter = async (request, route, http) => {
  const asynchronous = route.api === 'dashscope-async'
  let body = await http.json(asynchronous ? '/services/aigc/text2image/image-synthesis' : '/services/aigc/multimodal-generation/generation', { model: route.model.id, input: asynchronous ? { prompt: request.prompt } : { messages: [{ role: 'user', content: [...(request.referenceImages ?? []).map(image => ({ image })), { text: request.prompt }] }] }, parameters: { n: 1, ...(asynchronous ? {} : { enable_interleave: false }), ...(request.size ? { size: request.size.replace('x', '*') } : {}) } }, asynchronous ? { 'X-DashScope-Async': 'enable' } : {})
  let output = record(body.output)
  const taskId = output.task_id
  if (typeof taskId === 'string') {
    for (;;) {
      const status = output.task_status
      if (status === 'SUCCEEDED') break
      if (status !== 'PENDING' && status !== 'RUNNING') throw new Error(`Wan image task ended with status ${String(status)}`)
      await setTimeout(http.pollIntervalMs, undefined, { signal: http.signal })
      body = await http.json(`/tasks/${encodeURIComponent(taskId)}`)
      output = record(body.output)
    }
  }
  const images: string[] = []
  for (const raw of Array.isArray(output.results) ? output.results : []) { const item = record(raw); if (typeof item.url === 'string') images.push(item.url) }
  for (const raw of Array.isArray(output.choices) ? output.choices : []) { const message = record(record(raw).message); for (const part of Array.isArray(message.content) ? message.content : []) { const item = record(part); if (typeof item.image === 'string') images.push(item.image) } }
  if (images.length !== 1) throw new Error('Wan must return exactly one image')
  return { data: await imageValue(images[0]!, http), body }
}

/** Gemini generateContent with inline references and image output. */
export const gemini: ImageAdapter = async (request, route, http) => {
  const body = await http.json(`/models/${encodeURIComponent(route.model.id)}:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: request.prompt }, ...(request.referenceImages ?? []).map((value) => {
      const image = imageDataUrl(value, http.maxBytes)
      return { inlineData: { mimeType: image.mimeType, data: Buffer.from(image.data).toString('base64') } }
    })] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: {
      ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
      ...(request.size ? { imageSize: request.size } : {}),
    } },
  })
  const images: Uint8Array[] = []
  for (const raw of Array.isArray(body.candidates) ? body.candidates : []) { const content = record(record(raw).content); for (const rawPart of Array.isArray(content.parts) ? content.parts : []) { const part = record(rawPart); if (part.thought === true || !part.inlineData) continue; const data = record(part.inlineData); if (typeof data.mimeType === 'string' && data.mimeType.startsWith('image/') && typeof data.data === 'string') images.push(decodeBase64(data.data, http.maxBytes)) } }
  if (images.length !== 1) throw new Error('Gemini returned no single image')
  return { data: images[0]!, body }
}

export const imageAdapters: Readonly<Record<string, ImageAdapter>> = { 'openai-images': openai, 'openai-compatible': openai, dashscope, 'dashscope-async': dashscope, volcengine, gemini }
