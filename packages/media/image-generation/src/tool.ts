/** Image tool schemas, local reference admission, and durable result rendering. */
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resultFields } from '@deepseek-ai/dsh-generation-core'
import { imageDataUrl } from './adapters.ts'
import { imageMediaType } from './runtime.ts'
import type { ImageGenerationRuntime } from './runtime.ts'

const imageSchema = {
  type: 'object', additionalProperties: false, required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
    bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: { type: 'object', additionalProperties: false, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } } },
  },
} as const

/** Register catalog and generation; tool registry effects own unloading. */
export function applyImageTool(ctx: Context, runtime: ImageGenerationRuntime): void {
  ctx.tools.register(defineTool({
    name: 'list_image_models',
    description: 'List configured image providers, models, capabilities, sizes, and aspect ratio mappings.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute() { return runtime.catalog() },
  }))
  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate or edit one image. Consult list_image_models for routes and sizes. Reference images are local file paths or data URLs. Returns a saved image, its original file, and provider-reported usage (null means unknown). Show the saved image in your answer using its returned imagePath.',
    parameters: {
      prompt: { type: 'string', required: true }, provider: { type: 'string' }, model: { type: 'string' },
      size: { type: 'string' }, aspect_ratio: { type: 'string' },
      reference_images: { type: 'array', items: { type: 'string' }, description: 'Local image paths or data:image/...;base64,... values.' },
    },
    timeoutMs: runtime.config.timeoutMs ?? 180_000,
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ...resultFields, image: imageSchema, imagePath: { type: 'string' }, originalPath: { type: 'string' },
        original: { type: 'object', additionalProperties: false, required: true, properties: {
          attachmentId: { type: 'string', required: true }, name: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
        } },
      } },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value) },
        { type: 'image', attachment: { ...value.image, attachmentId: AttachmentId(value.image.attachmentId) } },
        { type: 'file', attachment: { ...value.original, attachmentId: AttachmentId(value.original.attachmentId) } },
      ],
      presentationMeta: (_args, value) => ({ provider: value.provider, model: value.model, usage: value.usage, elapsedMs: value.elapsedMs }),
    },
    async execute(args, exec) {
      const refs = args.reference_images ?? []
      if (refs.length > (runtime.config.maxReferenceImages ?? 8)) throw new Error('Too many reference images')
      const references: string[] = []
      const max = Math.min(runtime.config.maxResponseBytes ?? 32 * 1024 * 1024, ctx.attachments.imageLimits.maxImageBytes)
      for (const ref of refs) {
        exec.signal.throwIfAborted()
        let data: Uint8Array
        if (ref.startsWith('data:')) data = imageDataUrl(ref, max).data
        else {
          const fs = ctx.get('fs')
          if (!fs) throw new Error('Local reference images require a filesystem provider')
          const cwd = exec.agent?.session.header.cwd
          const target = await fs.resolve(ref, { ...(cwd === undefined ? {} : { cwd }), signal: exec.signal })
          const info = await fs.stat(target, exec.signal)
          if (info?.type !== 'file') throw new Error('Reference image is not a regular file')
          data = await fs.readBytes(target, exec.signal, max)
        }
        const mediaType = imageMediaType(data)
        await ctx.attachments.validateImage({ data, mediaType })
        references.push('data:' + mediaType + ';base64,' + Buffer.from(data).toString('base64'))
      }
      const result = await runtime.generate({
        prompt: args.prompt, ...(args.provider === undefined ? {} : { provider: args.provider }),
        ...(args.model === undefined ? {} : { model: args.model }),
        ...(args.size === undefined ? {} : { size: args.size }),
        ...(args.aspect_ratio === undefined ? {} : { aspectRatio: args.aspect_ratio }),
        referenceImages: references,
      }, exec.signal)
      exec.signal.throwIfAborted()
      const name = 'generated-image.' + result.mediaType.split('/')[1]
      const image = await ctx.attachments.saveImage({ data: result.data, mediaType: result.mediaType, name })
      const original = await ctx.attachments.saveFile({ data: result.data, name })
      const imagePath = ctx.attachments.imageHostPath(image)
      const originalPath = ctx.attachments.fileHostPath(original)
      return {
        provider: result.provider, model: result.model, usage: result.usage, elapsedMs: result.elapsedMs,
        ...(result.requestId === undefined ? {} : { requestId: result.requestId }),
        image, original, ...(imagePath ? { imagePath } : {}), ...(originalPath ? { originalPath } : {}),
      }
    },
  }))
}
