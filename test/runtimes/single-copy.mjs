// An app that loads the SDK both with import and with require (for example through a
// CommonJS dependency) must get ONE copy, or `error instanceof APIError` fails across them.
// The "module-sync" (Node.js 22.12+) and "bun" export conditions point require() at the ESM
// build. Uses the package's own name, which resolves to this checkout's dist/.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const imported = await import('@flashpi/node')
const required = require('@flashpi/node')

for (const name of ['Flashpi', 'APIError', 'FlashpiError', 'RateLimitError', 'Page']) {
  if (imported[name] !== required[name]) {
    throw new Error(`import and require loaded two copies of ${name}`)
  }
}
const runtime =
  typeof globalThis.Bun !== 'undefined'
    ? `Bun ${globalThis.Bun.version}`
    : `Node.js ${process.version}`
console.log(`${runtime}: import and require share one copy`)
