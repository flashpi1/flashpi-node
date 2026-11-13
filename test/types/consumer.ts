/**
 * Compiled by `pnpm typecheck` as a consumer would see the SDK: with the DOM library instead of
 * @types/node (Next.js, Deno and Workers projects) and with exactOptionalPropertyTypes. Never run.
 */
import { Flashpi, type RequestOptions, unwrapWebhook, type WebhookVerifyOptions } from '../../src'

declare const id: string
declare const env: Record<string, string | undefined>

export async function servePdf(flashpi: Flashpi): Promise<Response> {
  const pdf = await flashpi.documents.pdf(id)
  const blob = new Blob([pdf], { type: 'application/pdf' })
  console.log(blob.size)
  return new Response(pdf, { headers: { 'content-type': 'application/pdf' } })
}

export function forwardsOptionalConfig(): Flashpi {
  const options: RequestOptions = {
    idempotencyKey: env.ORDER_KEY,
    timeout: undefined,
    language: undefined,
  }
  console.log(options)
  return new Flashpi({ apiKey: env.FLASHPI_API_KEY, baseUrl: env.FLASHPI_BASE_URL })
}

/** Request headers in every shape `new Headers()` takes, with and without the DOM library. */
export async function sendsHeaders(
  flashpi: Flashpi,
  init: RequestInit['headers'],
  request: Request,
): Promise<void> {
  const pairs: [string, string][] = [['x-trace', 'trace-1']]
  const readonlyPairs: readonly (readonly [string, string])[] = pairs
  await flashpi.status.get({ headers: { 'x-trace': 'trace-1' } })
  await flashpi.status.get({ headers: new Headers({ 'x-trace': 'trace-1' }) })
  await flashpi.status.get({ headers: request.headers })
  await flashpi.status.get({ headers: [['x-trace', 'trace-1']] })
  await flashpi.status.get({ headers: readonlyPairs })
  await flashpi.status.get({ headers: new Map(pairs) })
  await flashpi.status.get({ headers: init })
  const options: RequestOptions = { headers: init }
  console.log(options)
}

/** defaultHeaders in the same shapes. */
export function setsDefaultHeaders(init: RequestInit['headers'], request: Request): Flashpi[] {
  const pairs: [string, string][] = [['x-team', 'billing']]
  return [
    new Flashpi({ defaultHeaders: { 'x-team': 'billing' } }),
    new Flashpi({ defaultHeaders: new Headers(pairs) }),
    new Flashpi({ defaultHeaders: request.headers }),
    new Flashpi({ defaultHeaders: [['x-team', 'billing']] }),
    new Flashpi({ defaultHeaders: new Map(pairs) }),
    new Flashpi({ defaultHeaders: init }),
  ]
}

export async function receives(request: Request): Promise<Response> {
  const options: WebhookVerifyOptions = { tolerance: undefined }
  const event = await unwrapWebhook(
    await request.text(),
    request.headers,
    env.FLASHPI_WEBHOOK_SECRET ?? '',
    options,
  )
  if (event.type === 'webhook_endpoint.verification') {
    return Response.json({ challenge: event.data.challenge })
  }
  return new Response(null, { status: 204 })
}
