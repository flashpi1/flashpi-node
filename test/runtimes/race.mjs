// Two modules load the SDK at the same moment, one with import and one with require (lazy route
// modules on a server's first requests). Both must load, and share one copy. On Node.js,
// require() of an ES module can fail in this race (ERR_REQUIRE_ESM_RACE_CONDITION), which is why
// the "node" export condition serves the CommonJS build to both.
const [esm, cjs] = await Promise.allSettled([import('./race-esm.mjs'), import('./race-cjs.cjs')])
if (esm.status !== 'fulfilled' || cjs.status !== 'fulfilled') {
  throw new Error(
    `Concurrent import and require failed: ${String(esm.reason ?? '')} ${String(cjs.reason ?? '')}`,
  )
}
const fromRequire = cjs.value.default?.APIError ?? cjs.value.APIError
if (esm.value.APIError !== fromRequire) throw new Error('The race loaded two copies of APIError')

const runtime =
  typeof globalThis.Bun !== 'undefined'
    ? `Bun ${globalThis.Bun.version}`
    : `Node.js ${process.version}`
console.log(`${runtime}: concurrent import and require load one copy`)
