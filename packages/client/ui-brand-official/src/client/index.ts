/**
 * Retired official-brand plugin.
 *
 * This deployment ships as Lingda Harness, so the sidebar brand slots stay on
 * the generic local-build fallback (`brand.localBuild`) in every build profile.
 * The plugin row remains mounted for composition compatibility but registers
 * no occupant: the former DeepSeek wordmark must never reappear in a build.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/** Leave the sidebar brand slots to their declaring fallback. @param _ctx - Client root context. */
export function apply(_ctx: ClientContext): void {}
