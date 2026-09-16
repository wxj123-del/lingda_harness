/** Installable image generation plugin over the tools and attachment services. */
import type { Context } from '@deepseek-ai/cordis'
import { MediaConfigSchema } from '@deepseek-ai/dsh-generation-core'
import type { MediaConfig } from '@deepseek-ai/dsh-generation-core'
import { ImageGenerationRuntime } from './runtime.ts'
import { applyImageTool } from './tool.ts'
export type * from './types.ts'
export { ImageGenerationRuntime } from './runtime.ts'
export const name = 'image-generation'
export const inject = ['tools', 'attachments', 'credentials']
export type Config = MediaConfig
export const Config = MediaConfigSchema

/** Register disposable generation and catalog tools. */
export function apply(ctx: Context, config: Config): void {
  applyImageTool(ctx, new ImageGenerationRuntime(ctx, config))
}
