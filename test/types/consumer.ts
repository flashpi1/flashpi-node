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
