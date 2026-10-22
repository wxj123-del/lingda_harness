import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import { describe, expect, it, onTestFinished } from 'vitest'
import { PythonPtcRuntime, resolveSupportedPythonBin } from '../src/index.ts'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'

const pythonBin = resolveSupportedPythonBin('python3')

/** Probe the real local runner before exercising file confinement. */
const sandboxUsable = await (async () => {
  if (pythonBin === undefined) return false
  const ctx = new Context()
  try {
    await ctx.plugin(Sandbox, {})
    await ctx.sandbox.confine([pythonBin, '--version'], { mode: 'read-only', workspaceRoot: process.cwd() })
    return true
  } catch (error: unknown) {
    if (error instanceof SandboxUnavailableError) return false
    throw error
  } finally {
    await ctx.fiber.dispose()
  }
})()

async function setup(mode: SandboxMode): Promise<{ run: (program: string) => ReturnType<PythonPtcRuntime['run']>; root: string }> {
  if (pythonBin === undefined) throw new Error('python3 is not available')
  const root = await mkdtemp(join(homedir(), '.dsh-python-sandbox-test-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const ctx = new Context()
  const sandboxFiber = await ctx.plugin(Sandbox, {})
  const runtimeFiber = await ctx.plugin(PythonPtcRuntime, { pythonBin, maxWallMs: 15_000 })
  const runtime = ctx.ptcRuntime as PythonPtcRuntime
  const policy = { mode, workspaceRoot: workspace }
  onTestFinished(async () => {
    await runtimeFiber.dispose()
    await sandboxFiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return {
    root,
    run: program => runtime.run(runtime.resolve({ program, bindings: [], cwd: workspace, sandboxPolicy: policy })),
  }
}

describe('PythonPtcRuntime file confinement', () => {
  it.skipIf(!sandboxUsable)('allows workspace writes and blocks writes outside the workspace', async () => {
    const { run, root } = await setup('workspace-write')
    const inside = join(root, 'workspace', 'inside.txt')
    const outside = join(root, 'outside.txt')
    const insideResult = await run(`open(${JSON.stringify(inside)}, "w").write("inside")\nreturn True`)
    expect(insideResult.error).toBeUndefined()
    expect(insideResult.sandbox).toMatchObject({ mode: 'workspace-write', enforcement: 'full' })
    await expect(readFile(inside, 'utf8')).resolves.toBe('inside')

    const outsideResult = await run(`open(${JSON.stringify(outside)}, "w").write("outside")`)
    expect(outsideResult.error?.kind).toBe('exception')
    expect(outsideResult.sandbox).toMatchObject({ mode: 'workspace-write', denied: true })
    await expect(stat(outside)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)

  it.skipIf(!sandboxUsable)('blocks workspace writes in read-only mode', async () => {
    const { run, root } = await setup('read-only')
    const target = join(root, 'workspace', 'read-only.txt')
    const result = await run(`open(${JSON.stringify(target)}, "w").write("blocked")`)
    expect(result.error?.kind).toBe('exception')
    expect(result.sandbox).toMatchObject({ mode: 'read-only', denied: true, enforcement: 'full' })
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)

  it('fails closed when a restricted policy has no sandbox provider', async () => {
    if (pythonBin === undefined) return
    const ctx = new Context()
    const workspaceRoot = process.cwd()
    ctx.provide('sandboxPolicy', {
      defaultMode: 'read-only',
      workspaceRoot,
      resolve: () => ({ mode: 'read-only', workspaceRoot }),
    } as never)
    const fiber = await ctx.plugin(PythonPtcRuntime, { pythonBin, maxWallMs: 15_000 })
    try {
      const runtime = ctx.ptcRuntime as PythonPtcRuntime
      const result = await runtime.run(runtime.resolve({
        program: 'return 1',
        bindings: [],
        cwd: workspaceRoot,
        sandboxPolicy: { mode: 'read-only', workspaceRoot },
      }))
      expect(result.error?.kind).toBe('sandbox-unavailable')
      expect(result.sandbox).toEqual({ mode: 'read-only', denied: false })
    } finally {
      await fiber.dispose()
    }
  })
})
