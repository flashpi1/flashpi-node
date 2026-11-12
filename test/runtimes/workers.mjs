// Runs worker.mjs on workerd, the Cloudflare Workers runtime, through Miniflare. No
// compatibility flags: the SDK must work without nodejs_compat.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

const miniflare = new Miniflare({
  modules: [
    { type: 'ESModule', path: path.join(here, 'worker.mjs') },
    { type: 'ESModule', path: path.join(here, 'smoke.mjs') },
    { type: 'ESModule', path: path.join(root, 'dist/index.mjs') },
  ],
  modulesRoot: root,
  compatibilityDate: '2026-08-01',
})

try {
  const response = await miniflare.dispatchFetch('http://localhost/')
  const text = await response.text()
  if (response.status !== 200) {
    console.error(text)
    process.exitCode = 1
  } else {
    console.log('Cloudflare Workers (workerd): smoke test passed')
  }
} finally {
  await miniflare.dispose()
}
