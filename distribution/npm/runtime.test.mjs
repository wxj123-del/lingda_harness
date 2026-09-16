import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const runtimeModule = new URL('./runtime.mjs', import.meta.url).href

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'lingda-runtime-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const packageRoot = join(root, 'package')
  const data = join(root, 'data')
  const counter = join(root, 'installs')
  const npmCli = join(root, 'npm-cli.js')
  await mkdir(join(packageRoot, 'packages'), { recursive: true })
  const body = Buffer.from('local package fixture')
  await writeFile(join(packageRoot, 'packages/runtime.tgz'), body)
  await writeFile(join(packageRoot, 'runtime.json'), JSON.stringify({ packages: [{
    name: '@deepseek-ai/dsh', file: 'runtime.tgz',
    integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
  }] }))
  await writeFile(npmCli, `
    const fs = require('node:fs');
    fs.appendFileSync(process.env.LINGDA_TEST_COUNTER, 'installed\\n');
    if (process.env.LINGDA_TEST_FAIL) process.exit(7);
    function finish() {
      for (const file of ['node_modules/@deepseek-ai/dsh/lib/bin.js', 'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html']) {
        fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
        fs.writeFileSync(file, 'fixture');
      }
    }
    if (process.env.LINGDA_TEST_CONCURRENT) {
      const timer = setInterval(() => {
        if (fs.readFileSync(process.env.LINGDA_TEST_COUNTER, 'utf8').trim().split('\\n').length === 2) {
          clearInterval(timer); finish();
        }
      }, 10);
    } else finish();
  `)
  const run = extra => execute(process.execPath, ['--input-type=module', '-e', `
    import { prepareRuntime } from ${JSON.stringify(runtimeModule)};
    console.log(await prepareRuntime(new URL(process.argv[1]), process.argv[2]));
  `, pathToFileURL(`${packageRoot}/`).href, data], {
    timeout: 20_000,
    env: { ...process.env, npm_execpath: npmCli, LINGDA_TEST_COUNTER: counter, ...extra },
  })
  return { root, packageRoot, data, counter, run }
}

test('installs local runtime packages once and reuses the completed cache', async t => {
  const f = await fixture(t)
  const first = await f.run()
  const second = await f.run()
  assert.equal(first.stdout, second.stdout)
  assert.equal(await readFile(f.counter, 'utf8'), 'installed\n')
  assert.equal((await readdir(join(f.data, 'runtimes'))).length, 1)
})

test('rejects modified release tarballs before starting npm', async t => {
  const f = await fixture(t)
  await writeFile(join(f.packageRoot, 'packages/runtime.tgz'), 'changed')
  await assert.rejects(f.run(), /checksum mismatch/)
  await assert.rejects(readFile(f.counter), { code: 'ENOENT' })
})

test('failed installation cleans staging and a later launch retries', async t => {
  const f = await fixture(t)
  await assert.rejects(f.run({ LINGDA_TEST_FAIL: '1' }), /installation failed \(7\)/)
  assert.deepEqual(await readdir(join(f.data, 'runtimes')), [])
  await f.run()
  assert.equal(await readFile(f.counter, 'utf8'), 'installed\ninstalled\n')
})

test('simultaneous first launches publish one complete runtime', async t => {
  const f = await fixture(t)
  const results = await Promise.all([f.run({ LINGDA_TEST_CONCURRENT: '1' }), f.run({ LINGDA_TEST_CONCURRENT: '1' })])
  assert.equal(results[0].stdout, results[1].stdout)
  assert.equal((await readdir(join(f.data, 'runtimes'))).length, 1)
  assert.equal(await readFile(f.counter, 'utf8'), 'installed\ninstalled\n')
})
