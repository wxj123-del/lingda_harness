import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { clientBundle } from '../tsdown.client.ts'

const build = clientBundle('@deepseek-ai/dsh-client-ui-layout', ['lib/types/index.js'])
const require = createRequire(import.meta.url)

// Pin browser entry points so the closure bundle never requests Node modules.
export default (options: Parameters<typeof build>[0]) => build(options).map(config => config.platform === 'browser' ? {
  ...config,
  alias: {
    fflate: join(dirname(require.resolve('fflate/package.json')), 'esm/browser.js'),
    yaml: join(dirname(require.resolve('yaml/package.json')), 'browser/index.js'),
  },
} : config)
