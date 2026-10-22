/** Reject compiler output that leaked into package source directories. */

import { existsSync, globSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SOURCE_ROOT = 'packages/*/*/src'

/** Convert a host path to the repository's stable slash form. */
function repositoryPath(path: string): string {
  return path.split(sep).join('/')
}

/**
 * Find generated JavaScript, sourcemaps, and declarations shadowing a source file.
 * @param root - repository or test-fixture root.
 * @returns Deterministic path-qualified violations.
 */
export function sourceArtifactViolations(root: string): string[] {
  const violations = new Set<string>()
  const forbidden = globSync([
    `${SOURCE_ROOT}/**/*.js`,
    `${SOURCE_ROOT}/**/*.js.map`,
    `${SOURCE_ROOT}/**/*.d.ts.map`,
  ], { cwd: root })

  for (const path of forbidden) {
    violations.add(`${repositoryPath(path)}: generated artifact must be emitted below lib/, not src/`)
  }

  for (const rawPath of globSync(`${SOURCE_ROOT}/**/*.d.ts`, { cwd: root })) {
    const path = repositoryPath(rawPath)
    const stem = path.slice(0, -'.d.ts'.length)
    if (['.ts', '.tsx', '.mts', '.cts'].some(extension => existsSync(resolve(root, `${stem}${extension}`)))) {
      violations.add(`${path}: generated declaration shadows an adjacent TypeScript source file`)
    }
  }

  return [...violations].sort()
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const failures = sourceArtifactViolations(ROOT)
  if (failures.length > 0) {
    process.stderr.write('verify-source-artifacts: compiler output leaked into package source directories:\n')
    for (const failure of failures) process.stderr.write(`  ${failure}\n`)
    process.exit(1)
  }
  process.stdout.write('verify-source-artifacts: package source directories contain no compiler output.\n')
}
