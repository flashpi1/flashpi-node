import { WebhookVerificationError } from './core/errors'
import type { WebhookEvent } from './types'

/**
 * The request headers of a webhook: a `Headers` object (fetch, Workers, Next.js, Hono) or a
 * plain object (Node.js `req.headers`, Express). Names are matched without case.
 */
export type WebhookHeaders = Headers | Record<string, string | readonly string[] | undefined>

/** The exact body of the webhook request, before any JSON parsing. */
export type WebhookPayload = string | Uint8Array | ArrayBuffer

export interface WebhookVerifyOptions {
  /** Largest gap, in seconds, between `webhook-timestamp` and now (default 300). */
  tolerance?: number | undefined
  /** The current time, for tests (a Date or Unix milliseconds). */
  now?: Date | number | undefined
}

/** Default largest gap between a webhook's timestamp and the receiver's clock. */
export const WEBHOOK_TOLERANCE_SECONDS = 300

const SECRET_PREFIX = 'whsec_'
/** Key sizes of a Standard Webhooks secret (Flashpi makes 32-byte keys). */
const MIN_SECRET_BYTES = 24
const MAX_SECRET_BYTES = 64
const SIGNATURE_BYTES = 32
const encoder = new TextEncoder()

/**
 * Checks that a webhook comes from Flashpi (Standard Webhooks: HMAC-SHA256 over
 * `webhook-id.webhook-timestamp.body` with the endpoint's `whsec_` secret) and is recent.
 * Throws a WebhookVerificationError otherwise: answer 400 and ignore the request.
 *
 * Pass the raw body exactly as received. A body parsed and serialized again does not match.
 */
export async function verifyWebhookSignature(
  payload: WebhookPayload,
  headers: WebhookHeaders,
  secret: string,
  options: WebhookVerifyOptions = {},
): Promise<void> {
  const { tolerance, nowMs } = verifyOptions(options)
  const keyBytes = secretBytes(secret)
  const id = header(headers, 'webhook-id')
  const timestamp = header(headers, 'webhook-timestamp')
  const signatures = header(headers, 'webhook-signature')
  if (!id || !timestamp || !signatures) {
    throw new WebhookVerificationError(
      'missing_headers',
      'The webhook-id, webhook-timestamp and webhook-signature headers are required',
    )
  }
  if (!/^\d{1,12}$/.test(timestamp)) {
    throw new WebhookVerificationError('invalid_timestamp', 'The webhook-timestamp is not valid')
  }
  // Written so that anything unexpected fails closed.
  if (!(Math.abs(Math.floor(nowMs / 1_000) - Number(timestamp)) <= tolerance)) {
    throw new WebhookVerificationError(
      'timestamp_out_of_range',
      `The webhook-timestamp is more than ${tolerance} seconds away from now`,
    )
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = concat(encoder.encode(`${id}.${timestamp}.`), payloadBytes(payload))
  // One HMAC per request, however many signatures the header lists.
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed))
  for (const entry of signatures.split(' ')) {
    const comma = entry.indexOf(',')
    if (comma === -1 || entry.slice(0, comma) !== 'v1') continue
    const signature = decodeBase64(entry.slice(comma + 1))
    if (signature?.length === SIGNATURE_BYTES && equalBytes(signature, expected)) return
  }
  throw new WebhookVerificationError(
    'no_matching_signature',
    'No webhook-signature matches the body and the secret',
  )
}

/**
 * Verifies a webhook (see `verifyWebhookSignature`) and returns its parsed body, typed by
 * `type`. Endpoints in thin mode receive no `data`: use `unwrapWebhook<ThinWebhookEvent>(...)`.
 *
 * ```ts
 * const event = await unwrapWebhook(rawBody, req.headers, process.env.FLASHPI_WEBHOOK_SECRET!)
 * if (event.type === 'webhook_endpoint.verification') {
 *   return res.json({ challenge: event.data.challenge })
 * }
 * ```
 */
export async function unwrapWebhook<T = WebhookEvent>(
  payload: WebhookPayload,
  headers: WebhookHeaders,
  secret: string,
  options?: WebhookVerifyOptions,
): Promise<T> {
  await verifyWebhookSignature(payload, headers, secret, options)
  const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new WebhookVerificationError('invalid_payload', 'The webhook body is not JSON')
  }
}

/** Webhook helpers, also available as `flashpi.webhooks`. They need no API key. */
export class Webhooks {
  /** See {@link verifyWebhookSignature}. */
  verifySignature(
    payload: WebhookPayload,
    headers: WebhookHeaders,
    secret: string,
    options?: WebhookVerifyOptions,
  ): Promise<void> {
    return verifyWebhookSignature(payload, headers, secret, options)
  }

  /** See {@link unwrapWebhook}. */
  unwrap<T = WebhookEvent>(
    payload: WebhookPayload,
    headers: WebhookHeaders,
    secret: string,
    options?: WebhookVerifyOptions,
  ): Promise<T> {
    return unwrapWebhook<T>(payload, headers, secret, options)
  }
}

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (isHeaders(headers)) return headers.get(name) ?? undefined
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue
    if (value === undefined || typeof value === 'string') return value
    // Repeated headers: join signature lists, take the first of the others.
    return name === 'webhook-signature' ? value.join(' ') : value[0]
  }
  return undefined
}

function isHeaders(headers: WebhookHeaders): headers is Headers {
  return typeof (headers as Partial<Headers>).get === 'function'
}

function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new WebhookVerificationError(
      'invalid_secret',
      'The webhook secret is empty: copy it from the console or webhookEndpoints.getSecret()',
    )
  }
  const trimmed = secret.trim()
  const encoded = trimmed.startsWith(SECRET_PREFIX) ? trimmed.slice(SECRET_PREFIX.length) : trimmed
  const bytes = decodeBase64(encoded)
  if (!bytes || bytes.length === 0) {
    throw new WebhookVerificationError(
      'invalid_secret',
      'The webhook secret is not a whsec_ secret (base64 after the prefix)',
    )
  }
  if (bytes.length < MIN_SECRET_BYTES || bytes.length > MAX_SECRET_BYTES) {
    throw new WebhookVerificationError(
      'invalid_secret',
      'The webhook secret is not a complete whsec_ secret: copy it again from the console or webhookEndpoints.getSecret()',
    )
  }
  return bytes
}

/** The checked tolerance and clock. Bad values are programming errors, so they throw TypeError. */
function verifyOptions(options: WebhookVerifyOptions): { tolerance: number; nowMs: number } {
  const tolerance = options.tolerance ?? WEBHOOK_TOLERANCE_SECONDS
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0) {
    throw new TypeError('tolerance must be a number of seconds, 0 or more')
  }
  const nowMs = Number(options.now ?? Date.now())
  if (!Number.isFinite(nowMs)) {
    throw new TypeError('now must be a valid Date or a number of Unix milliseconds')
  }
  return { tolerance, nowMs }
}

/** Compares two byte arrays of the same length in constant time. */
function equalBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false
  let difference = 0
  for (let index = 0; index < first.length; index++) {
    difference |= (first[index] ?? 0) ^ (second[index] ?? 0)
  }
  return difference === 0
}

function payloadBytes(payload: WebhookPayload): Uint8Array {
  if (typeof payload === 'string') return encoder.encode(payload)
  // Checks that also hold across realms (a body from another VM context or a test runner).
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
  }
  if (Object.prototype.toString.call(payload) === '[object ArrayBuffer]') {
    return new Uint8Array(payload)
  }
  throw new WebhookVerificationError(
    'invalid_payload',
    'Pass the raw webhook body as a string, Uint8Array or ArrayBuffer (not parsed JSON)',
  )
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(first.length + second.length)
  result.set(first)
  result.set(second, first.length)
  return result
}

/** Standard base64 to bytes, or `null` when it is not base64. */
function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) return null
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}
