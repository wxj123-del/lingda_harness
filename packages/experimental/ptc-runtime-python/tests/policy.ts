import type { Context } from '@deepseek-ai/cordis'

/** Mount the minimal explicit policy used by mocked runtime tests. */
export function provideDangerPolicy(ctx: Context): void {
  const workspaceRoot = process.cwd()
  ctx.provide('sandboxPolicy', {
    defaultMode: 'danger-full-access',
    workspaceRoot,
    resolve: () => ({ mode: 'danger-full-access', workspaceRoot }),
  } as never)
}
