// Node.js and Bun loading the CommonJS build with require().
/* eslint-disable @typescript-eslint/no-require-imports */
const sdk = require('../../dist/index.cjs')

const runtime =
  typeof globalThis.Bun !== 'undefined'
    ? `Bun ${globalThis.Bun.version}`
    : `Node.js ${process.version}`

import('./smoke.mjs')
  .then(({ runSmoke }) => runSmoke(sdk))
  .then(() => {
    console.log(`${runtime} (CommonJS): smoke test passed`)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
