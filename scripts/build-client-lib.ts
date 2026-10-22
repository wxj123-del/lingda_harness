import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pnpmInvocation } from './pnpm-invocation.ts'

const root = resolve(import.meta.dirname, '..')

/** Execute one Client build step and return its process status. */
export type ClientBuildStep = (args: string[]) => number

function run(args: string[]): number {
  const invocation = pnpmInvocation(args, process.env)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  return result.status ?? 1
}

/**
 * Build Client declarations and bundles without publishing unchecked output.
 * @param execute - process seam used by the CLI and status-order tests.
 * @returns the first non-zero status, or zero when both steps pass.
 */
export function buildClientLibrary(execute: ClientBuildStep = run): number {
  const typecheckStatus = execute(['exec', 'tsc', '-b', 'tsconfig.client.json'])
  if (typecheckStatus !== 0) return typecheckStatus
  return execute(['exec', 'tsdown', '--env.DSH_BUILD_FACE', 'client'])
}

if (import.meta.main) process.exitCode = buildClientLibrary()
