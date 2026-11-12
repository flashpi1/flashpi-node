// A Cloudflare Worker that runs the smoke test on workerd (see workers.mjs).
import * as sdk from '../../dist/index.mjs'
import { runSmoke } from './smoke.mjs'

export default {
  async fetch() {
    try {
      return new Response(await runSmoke(sdk))
    } catch (error) {
      return new Response(String(error?.stack ?? error), { status: 500 })
    }
  },
}
