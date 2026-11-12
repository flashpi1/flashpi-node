import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  type AccountEmailSending,
  type Certificate,
  type Document,
  Flashpi,
  type ThinWebhookEvent,
  unwrapWebhook,
  verifyWebhookSignature,
  WebhookVerificationError,
  type WebhookEvent,
  type WebhookHeaders,
  type WebhookPayload,
} from '../src'
import { TEST_KEY } from './support'

/** The example of the Standard Webhooks specification (24-byte key). */
const STANDARD = {
  secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: '1614265330',
  body: '{"test": 2432232314}',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
}

/** The example of Flashpi's webhook docs (32-byte key), the same the API's tests sign. */
const FLASHPI = {
  secret: 'whsec_Zmxhc2hwaS1kb2NzLWV4YW1wbGUtc2VjcmV0LTMyLWI=',
  id: '019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b',
  timestamp: '1792152000',
  body: '{"id":"019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b","type":"invoice.authorized","environment":"test","createdAt":"2026-10-16T17:20:00.000Z"}',
  signature: 'v1,HbWOpDPWCo3wtq41t9GVHUpg69M1zgvveoDJmSWkA8U=',
}

function headersOf(vector: typeof FLASHPI, signature = vector.signature): Record<string, string> {
  return {
    'webhook-id': vector.id,
    'webhook-timestamp': vector.timestamp,
    'webhook-signature': signature,
  }
}

const at = (vector: typeof FLASHPI, offsetSeconds = 0): { now: number } => ({
  now: (Number(vector.timestamp) + offsetSeconds) * 1_000,
})

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof WebhookVerificationError) return error.reason
    throw error
  }
  return 'verified'
}

describe('verifyWebhookSignature', () => {
  it('accepts the Standard Webhooks example', async () => {
    const result = reason(
      verifyWebhookSignature(STANDARD.body, headersOf(STANDARD), STANDARD.secret, at(STANDARD)),
    )
    expect(await result).toBe('verified')
  })

  it('accepts the example of Flashpi’s docs', async () => {
    const result = reason(
      verifyWebhookSignature(FLASHPI.body, headersOf(FLASHPI), FLASHPI.secret, at(FLASHPI)),
    )
    expect(await result).toBe('verified')
  })

  it('signs the raw bytes: a UTF-8 body as text, Uint8Array or ArrayBuffer', async () => {
    const body =
      '{"id":"019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b","type":"invoice.authorized","environment":"test","createdAt":"2026-10-16T17:20:00.000Z","data":{"counterparty":{"name":"Panadería Ñandú €"}}}'
    const headers = headersOf(FLASHPI, 'v1,fdAGYFcvd+G8WvVy6jtQtuduKm8mENxuA/zTqcWYSJY=')
    const bytes = new TextEncoder().encode(body)
    expect(bytes.length).toBe(191)
    const payloads: WebhookPayload[] = [body, bytes, bytes.buffer, Buffer.from(body, 'utf8')]
    for (const payload of payloads) {
      expect(
        await reason(verifyWebhookSignature(payload, headers, FLASHPI.secret, at(FLASHPI))),
      ).toBe('verified')
    }
  })

  it('accepts a body of any bytes (Standard Webhooks binary example)', async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index)
    const headers = headersOf(STANDARD, 'v1,sEcZ042G8Crqgxbybb3y0eDxQR3TcfYsk11I1XULhSI=')
    expect(
      await reason(verifyWebhookSignature(bytes, headers, STANDARD.secret, at(STANDARD))),
    ).toBe('verified')
  })

  it('accepts either secret during a rotation', async () => {
    const rotation =
      'v1,HbWOpDPWCo3wtq41t9GVHUpg69M1zgvveoDJmSWkA8U= v1,dZdgetSIp5ZOSjhz50Gcz1N1hb/WBvK3IdncOP52NrQ='
    for (const secret of [FLASHPI.secret, STANDARD.secret]) {
      const result = verifyWebhookSignature(
        FLASHPI.body,
        headersOf(FLASHPI, rotation),
        secret,
        at(FLASHPI),
      )
      expect(await reason(result)).toBe('verified')
    }
  })

  it('skips decoys, malformed entries and other versions', async () => {
    const signature = [
      'v1,Ceo5qEr07ixe2NLpvHk3FH9bwy/WavXrAFQ/9tdO6mc=',
      'v2,' + FLASHPI.signature.slice(3),
      'v1',
      'v1,not-base64!',
      '',
      FLASHPI.signature,
    ].join(' ')
    const result = verifyWebhookSignature(
      FLASHPI.body,
      headersOf(FLASHPI, signature),
      FLASHPI.secret,
      at(FLASHPI),
    )
    expect(await reason(result)).toBe('verified')
  })

  it('accepts the secret without its whsec_ prefix and with spaces around it', async () => {
    const result = verifyWebhookSignature(
      FLASHPI.body,
      headersOf(FLASHPI),
      ` ${FLASHPI.secret.slice('whsec_'.length)}\n`,
      at(FLASHPI),
    )
    expect(await reason(result)).toBe('verified')
  })

  it.each([
    ['an altered body', FLASHPI.body.replace('test', 'live'), FLASHPI.signature],
    ['a signature of another version only', FLASHPI.body, 'v2,' + FLASHPI.signature.slice(3)],
    ['a truncated signature', FLASHPI.body, FLASHPI.signature.slice(0, -4)],
    ['an empty signature', FLASHPI.body, 'v1,'],
    ['garbage', FLASHPI.body, 'v1,dawfeoifkpqwoekfpqoekf'],
  ])('rejects %s', async (_case, body, signature) => {
    const result = verifyWebhookSignature(
      body,
      headersOf(FLASHPI, signature),
      FLASHPI.secret,
      at(FLASHPI),
    )
    expect(await reason(result)).toBe('no_matching_signature')
  })

  it('rejects a body signed with another secret', async () => {
    const result = verifyWebhookSignature(
      FLASHPI.body,
      headersOf(FLASHPI),
      STANDARD.secret,
      at(FLASHPI),
    )
    expect(await reason(result)).toBe('no_matching_signature')
  })

  it('accepts timestamps up to 5 minutes away and rejects older or newer ones', async () => {
    const check = (offset: number): Promise<string> =>
      reason(
        verifyWebhookSignature(
          FLASHPI.body,
          headersOf(FLASHPI),
          FLASHPI.secret,
          at(FLASHPI, offset),
        ),
      )
    expect(await check(300)).toBe('verified')
    expect(await check(-300)).toBe('verified')
    expect(await check(301)).toBe('timestamp_out_of_range')
    expect(await check(-301)).toBe('timestamp_out_of_range')
  })

  it('takes another tolerance and a Date as now', async () => {
    const result = verifyWebhookSignature(FLASHPI.body, headersOf(FLASHPI), FLASHPI.secret, {
      tolerance: 10,
      now: new Date((Number(FLASHPI.timestamp) + 11) * 1_000),
    })
    expect(await reason(result)).toBe('timestamp_out_of_range')
  })

  it('checks the timestamp against the current clock by default', async () => {
    const result = verifyWebhookSignature(FLASHPI.body, headersOf(FLASHPI), FLASHPI.secret)
    expect(await reason(result)).toBe('timestamp_out_of_range')
  })

  it.each(['webhook-id', 'webhook-timestamp', 'webhook-signature'])(
    'rejects a request without %s',
    async (name) => {
      const headers = Object.fromEntries(
        Object.entries(headersOf(FLASHPI)).filter(([header]) => header !== name),
      )
      const result = verifyWebhookSignature(FLASHPI.body, headers, FLASHPI.secret, at(FLASHPI))
      expect(await reason(result)).toBe('missing_headers')
    },
  )

  it.each(['abc', '-1', '1792152000.5', '1234567890123'])(
    'rejects the timestamp %s',
    async (timestamp) => {
      const headers = { ...headersOf(FLASHPI), 'webhook-timestamp': timestamp }
      const result = verifyWebhookSignature(FLASHPI.body, headers, FLASHPI.secret, at(FLASHPI))
      expect(await reason(result)).toBe('invalid_timestamp')
    },
  )

  it.each(['', 'whsec_', '   ', 'whsec_not base64!', 'whsec_a'])(
    'refuses the secret %j',
    async (secret) => {
      const result = verifyWebhookSignature(FLASHPI.body, headersOf(FLASHPI), secret, at(FLASHPI))
      expect(await reason(result)).toBe('invalid_secret')
    },
  )

  it('refuses a body that was already parsed', async () => {
    const parsed = JSON.parse(FLASHPI.body) as unknown as WebhookPayload
    const result = verifyWebhookSignature(parsed, headersOf(FLASHPI), FLASHPI.secret, at(FLASHPI))
    expect(await reason(result)).toBe('invalid_payload')
  })

  it('reads headers from a Headers object or any letter case, and joins repeated signatures', async () => {
    const variants: WebhookHeaders[] = [
      new Headers(headersOf(FLASHPI)),
      {
        'Webhook-Id': FLASHPI.id,
        'WEBHOOK-TIMESTAMP': FLASHPI.timestamp,
        'webhook-signature': FLASHPI.signature,
      },
      {
        'webhook-id': [FLASHPI.id, 'ignored'],
        'webhook-timestamp': [FLASHPI.timestamp],
        'webhook-signature': ['v1,Ceo5qEr07ixe2NLpvHk3FH9bwy/WavXrAFQ/9tdO6mc=', FLASHPI.signature],
        other: undefined,
      },
    ]
    for (const headers of variants) {
      expect(
        await reason(verifyWebhookSignature(FLASHPI.body, headers, FLASHPI.secret, at(FLASHPI))),
      ).toBe('verified')
    }
  })
})

describe('unwrapWebhook', () => {
  it('returns the verified event, typed by its type', async () => {
    const event = await unwrapWebhook(FLASHPI.body, headersOf(FLASHPI), FLASHPI.secret, at(FLASHPI))
    expect(event).toEqual(JSON.parse(FLASHPI.body))
    expectTypeOf(event).toEqualTypeOf<WebhookEvent>()
    // Type checks only (`pnpm typecheck`): narrowing on `type` gives the matching `data`.
    const _narrows = (narrowed: WebhookEvent): void => {
      if (narrowed.type === 'invoice.authorized')
        expectTypeOf(narrowed.data).toEqualTypeOf<Document>()
      if (narrowed.type === 'document.email.bounced')
        expectTypeOf(narrowed.data).toEqualTypeOf<Document>()
      if (narrowed.type === 'certificate.revoked')
        expectTypeOf(narrowed.data).toEqualTypeOf<Certificate>()
      if (narrowed.type === 'account.email_paused') {
        expectTypeOf(narrowed.data).toEqualTypeOf<AccountEmailSending>()
      }
      if (narrowed.type === 'webhook_endpoint.verification') {
        expectTypeOf(narrowed.data.challenge).toBeString()
      }
    }
  })

  it('types a thin event without data', async () => {
    const event = await unwrapWebhook<ThinWebhookEvent>(
      FLASHPI.body,
      headersOf(FLASHPI),
      FLASHPI.secret,
      at(FLASHPI),
    )
    expect(event.type).toBe('invoice.authorized')
    if (event.type !== 'webhook_endpoint.verification') {
      expectTypeOf(event).not.toHaveProperty('data')
    }
  })

  it('throws before parsing when the signature is wrong', async () => {
    const result = unwrapWebhook('not json', headersOf(FLASHPI), FLASHPI.secret, at(FLASHPI))
    expect(await reason(result)).toBe('no_matching_signature')
  })

  it('throws invalid_payload for a signed body that is not JSON', async () => {
    const vector = { ...STANDARD, body: 'not json' }
    // Signed with Node's crypto here to build the case.
    const { createHmac } = await import('node:crypto')
    const key = Buffer.from(STANDARD.secret.slice(6), 'base64')
    const signature = createHmac('sha256', key)
      .update(`${vector.id}.${vector.timestamp}.${vector.body}`)
      .digest('base64')
    const result = unwrapWebhook(
      vector.body,
      headersOf(vector, `v1,${signature}`),
      vector.secret,
      at(vector),
    )
    expect(await reason(result)).toBe('invalid_payload')
  })

  it('is available on the client as flashpi.webhooks', async () => {
    const flashpi = new Flashpi(TEST_KEY)
    const event = await flashpi.webhooks.unwrap(
      FLASHPI.body,
      headersOf(FLASHPI),
      FLASHPI.secret,
      at(FLASHPI),
    )
    expect(event.id).toBe(FLASHPI.id)
    await expect(
      flashpi.webhooks.verifySignature(
        FLASHPI.body,
        headersOf(FLASHPI),
        FLASHPI.secret,
        at(FLASHPI),
      ),
    ).resolves.toBeUndefined()
  })
})
