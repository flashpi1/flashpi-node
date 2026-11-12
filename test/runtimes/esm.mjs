// Node.js (ESM), Bun and Deno: `node|bun test/runtimes/esm.mjs`, `deno run test/runtimes/esm.mjs`.
import * as sdk from '../../dist/index.mjs'
import { runSmoke } from './smoke.mjs'

const runtime =
  typeof globalThis.Deno !== 'undefined'
    ? `Deno ${globalThis.Deno.version.deno}`
    : typeof globalThis.Bun !== 'undefined'
      ? `Bun ${globalThis.Bun.version}`
      : `Node.js ${process.version}`

await runSmoke(sdk)
console.log(`${runtime} (ESM): smoke test passed`)
