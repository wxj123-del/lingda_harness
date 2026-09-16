#!/usr/bin/env node
/** Launch the packaged Lingda runtime with a separate default data directory. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareRuntime } from '../runtime.mjs'

if (process.argv.length === 3 && ['--version', '-V'].includes(process.argv[2])) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  console.log(version)
} else {
  process.env.DSH_HOME ??= join(homedir(), '.lingda')
  if (process.argv.length === 2) process.argv.push('web')
  const runtime = await prepareRuntime(new URL('../', import.meta.url), process.env.DSH_HOME)
  const { runCli } = await import(pathToFileURL(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')).href)
  await runCli()
}
