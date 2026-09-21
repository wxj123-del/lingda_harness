import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pnpmInvocation } from './pnpm-invocation.ts'

const root = resolve(import.meta.dirname, '..')

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

// The Client aggregate includes tests and currently reports known contract
// diagnostics, but its referenced package projects still emit the JS that
// tsdown needs. Keep production builds usable while `typecheck:contracts-ready`
// remains the strict diagnostic command.
const typecheckStatus = run(['exec', 'tsc', '-b', 'tsconfig.client.json'])
const bundleStatus = run(['exec', 'tsdown', '--env.DSH_BUILD_FACE', 'client'])
if (bundleStatus !== 0) process.exit(bundleStatus)
if (typecheckStatus !== 0) {
  console.warn(`build: client aggregate typecheck exited with ${String(typecheckStatus)}; emitted artifacts were bundled`)
}
