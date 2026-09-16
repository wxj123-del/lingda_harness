/** Speech tool schemas and lossless durable audio results. */
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { resultFields } from '@deepseek-ai/dsh-generation-core'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SpeechGenerationRuntime } from './runtime.ts'

/** Register model listing and one-file text-to-speech generation. */
export function applySpeechTool(ctx: Context, runtime: SpeechGenerationRuntime): void {
  ctx.tools.register(defineTool({
    name: 'list_speech_models', description: 'List configured speech providers, models, voices, and output formats.',
    parameters: {}, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true, async execute() { return runtime.catalog() },
  }))
  ctx.tools.register(defineTool({
    name: 'generate_speech',
    description: 'Generate speech from text and return a saved audio file. Use list_speech_models for available voices and formats. Provider usage is null when unavailable. Link the returned path in your answer.',
    parameters: {
      text: { type: 'string', required: true }, provider: { type: 'string' }, model: { type: 'string' }, voice: { type: 'string' },
      format: { type: 'string', enum: ['mp3', 'wav', 'opus', 'flac', 'aac'] }, speed: { type: 'number' }, instructions: { type: 'string' },
    },
    timeoutMs: runtime.config.timeoutMs ?? 180_000,
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ...resultFields, mediaType: { type: 'string', required: true }, path: { type: 'string' },
        audio: { type: 'object', required: true, additionalProperties: false, properties: {
          attachmentId: { type: 'string', required: true }, name: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
        } },
      } },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value) },
        { type: 'file', attachment: { ...value.audio, attachmentId: AttachmentId(value.audio.attachmentId) } },
      ],
      presentationMeta: (_args, value) => ({ provider: value.provider, model: value.model, usage: value.usage, elapsedMs: value.elapsedMs }),
    },
    async execute(args, exec) {
      const result = await runtime.generate(args, exec.signal)
      exec.signal.throwIfAborted()
      const audio = await ctx.attachments.saveFile({ data: result.data, name: 'generated-speech.' + result.format })
      const path = ctx.attachments.fileHostPath(audio)
      return {
        provider: result.provider, model: result.model, mediaType: result.mediaType, elapsedMs: result.elapsedMs,
        usage: result.usage, audio, ...(path ? { path } : {}),
        ...(result.requestId === undefined ? {} : { requestId: result.requestId }),
      }
    },
  }))
}
