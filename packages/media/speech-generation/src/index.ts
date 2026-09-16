/** Installable speech generation plugin using durable file attachments. */
import type { Context } from '@deepseek-ai/cordis'
import { MediaConfigSchema } from '@deepseek-ai/dsh-generation-core'
import type { MediaConfig } from '@deepseek-ai/dsh-generation-core'
import { SpeechGenerationRuntime } from './runtime.ts'
import { applySpeechTool } from './tool.ts'
export type * from './types.ts'
export { SpeechGenerationRuntime } from './runtime.ts'
export const name = 'speech-generation'
export const inject = ['tools', 'attachments', 'credentials']
export type Config = MediaConfig
export const Config = MediaConfigSchema

/** Register disposable catalog and generation tools. */
export function apply(ctx: Context, config: Config): void {
  applySpeechTool(ctx, new SpeechGenerationRuntime(ctx, config))
}
