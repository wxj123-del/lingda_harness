/** Install immutable local runtime packages once per Node version and platform. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function npmInvocation(args) {
  const inherited = process.env.npm_execpath
  const candidates = [
    ...(inherited === undefined ? [] : [join(dirname(inherited), 'npm-cli.js')]),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  ]
  const npmCli = candidates.find(existsSync)
  if (npmCli !== undefined) return [process.execPath, [npmCli, ...args]]
  if (process.platform !== 'win32') return ['npm', args]
  throw new Error('Lingda Harness requires npm. Start it with npx or install Node.js with npm.')
}

function install(directory) {
  const [command, args] = npmInvocation(['install', '--omit=dev', '--no-audit', '--no-fund'])
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: directory, stdio: 'inherit' })
    const forward = signal => child.kill(signal)
    const interrupt = () => forward('SIGINT')
    const terminate = () => forward('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    const cleanup = () => {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
    }
    child.once('error', error => { cleanup(); reject(error) })
    child.once('close', (code, signal) => {
      cleanup()
      if (code === 0) accept()
      else reject(new Error(`Lingda runtime installation failed (${signal ?? code}). Run the command again to retry.`))
    })
  })
}

/**
 * Prepare a runtime from the release's local npm tarballs without source builds.
 * @param {URL} packageUrl - Directory containing runtime.json and packages/.
 * @param {string} dataDirectory - User-selected Lingda data directory.
 * @returns {Promise<string>} Complete runtime directory, ready for CLI import.
 */
export async function prepareRuntime(packageUrl, dataDirectory) {
  const root = fileURLToPath(packageUrl)
  const descriptor = await readFile(join(root, 'runtime.json'))
  const fingerprint = createHash('sha256').update(descriptor).digest('hex').slice(0, 24)
  const key = `${process.platform}-${process.arch}-node${process.versions.modules}-${fingerprint}`
  const cache = join(dataDirectory, 'runtimes')
  const destination = join(cache, key)
  const ready = join(destination, '.ready')
  if (existsSync(ready)) return destination
  const { packages } = JSON.parse(descriptor.toString('utf8'))
  const dependencies = {}
  for (const entry of packages) {
    const tarball = join(root, 'packages', entry.file)
    const integrity = `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`
    if (integrity !== entry.integrity) throw new Error(`Lingda package checksum mismatch: ${entry.file}`)
    dependencies[entry.name] = pathToFileURL(tarball).href
  }
  await mkdir(cache, { recursive: true })
  const staging = await mkdtemp(join(cache, '.install-'))
  try {
    await writeFile(join(staging, 'package.json'), JSON.stringify({
      name: 'lingda-local-runtime', private: true, version: '0.0.0', dependencies,
    }))
    console.error('Lingda Harness: installing runtime dependencies for the first launch...')
    await install(staging)
    const cli = join(staging, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    const web = join(staging, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html')
    if (!existsSync(cli) || !existsSync(web)) throw new Error('Lingda runtime installation omitted the CLI or Web UI.')
    await writeFile(join(staging, '.ready'), fingerprint)
    try {
      await rename(staging, destination)
    } catch (error) {
      // Simultaneous first launches may finish the same immutable runtime first.
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) || !existsSync(ready)) throw error
    }
    return destination
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
