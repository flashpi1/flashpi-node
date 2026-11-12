/**
 * Regression tests for the findings of the first review (2026-11-12).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  APIError,
  ConflictError,
  ConnectionError,
  Flashpi,
  FlashpiError,
  TimeoutError,
  unwrapWebhook,
  verifyWebhookSignature,
  WebhookVerificationError,
} from '../src'
import { ID, OTHER_ID, TEST_KEY, client, documentBody, json, problem, sentJson } from './support'

async function settle<T>(promise: PromiseLike<T>): Promise<{ value?: T; error?: unknown }> {
  const outcome = Promise.resolve(promise).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
  await vi.runAllTimersAsync()
  return outcome
}

describe('with fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('an earlier attempt still running (409 idempotency_key_in_progress on a retry)', () => {
    it('waits for it with the same key, without using up the retries', async () => {
      const inProgress = (): Response => problem(409, 'idempotency_key_in_progress')
      const { flashpi, sent } = client([
        new TypeError('socket hang up'),
        inProgress(),
        inProgress(),
        inProgress(),
        inProgress(),
        inProgress(),
        json(documentBody(ID, 'authorized'), 200, { 'idempotent-replayed': 'true' }),
      ])
      const started = Date.now()
      const { value } = await settle(
        flashpi.invoices.create({
          options: { waitForAuthorization: true, waitTimeoutSeconds: 30 },
        } as never),
      )
      expect(value).toMatchObject({ id: ID, status: 'authorized' })
      expect(sent).toHaveLength(7)
      expect(new Set(sent.map((request) => request.headers.get('idempotency-key'))).size).toBe(1)
      // 0.5 s backoff after the network error, then 1 + 2 + 4 + 5 + 5 s of waiting.
      expect(Date.now() - started).toBe(17_500)
    })

    it('stops when the call’s time is up and hands back the key', async () => {
      const replies = [
        new TypeError('socket hang up'),
        ...Array.from({ length: 20 }, () => problem(409, 'idempotency_key_in_progress')),
      ]
      const { flashpi, sent } = client(replies, { timeout: 10_000 })
      const started = Date.now()
      const { error } = await settle(flashpi.invoices.create({} as never))
      expect(error).toBeInstanceOf(ConflictError)
      const conflict = error as ConflictError
      expect(conflict.code).toBe('idempotency_key_in_progress')
      expect(conflict.idempotencyKey).toBe(sent[0]?.headers.get('idempotency-key'))
      expect(Date.now() - started).toBeLessThanOrEqual(10_000)
      expect(sent.length).toBeGreaterThan(3)
    })

    it('follows the normal retry rules on the first attempt (another process holds the key)', async () => {
      const { flashpi, sent } = client([
        problem(409, 'idempotency_key_in_progress'),
        problem(409, 'idempotency_key_in_progress'),
        problem(409, 'idempotency_key_in_progress'),
        problem(409, 'idempotency_key_in_progress'),
      ])
      const { error } = await settle(
        flashpi.invoices.create({} as never, { idempotencyKey: 'order-1', maxRetries: 0 }),
      )
      expect(error).toBeInstanceOf(ConflictError)
      expect(sent).toHaveLength(1)
    })

    it('recovers the document if the wait ends in idempotency_key_reused', async () => {
      const { flashpi, sent } = client([
        new TypeError('socket hang up'),
        problem(409, 'idempotency_key_in_progress'),
        problem(422, 'idempotency_key_reused', { documentId: OTHER_ID }),
        json(documentBody(OTHER_ID, 'authorized')),
      ])
      const { value } = await settle(flashpi.invoices.create({} as never))
      expect(value).toMatchObject({ id: OTHER_ID })
      expect(sent.at(-1)?.url.pathname).toBe(`/v1/documents/${OTHER_ID}`)
    })
  })

  describe('the Idempotency-Key on errors', () => {
    it('is on the API, connection and timeout errors of a POST', async () => {
      const api = client([problem(422, 'validation_failed')])
      const apiError = (await settle(api.flashpi.invoices.create({} as never))).error as APIError
      expect(apiError.idempotencyKey).toBe(api.sent[0]?.headers.get('idempotency-key'))

      const network = client([new TypeError('x')], { maxRetries: 0 })
      const connection = (await settle(network.flashpi.issuers.create({} as never))).error
      expect(connection).toBeInstanceOf(ConnectionError)
      expect((connection as ConnectionError).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)

      const hang = (request: { signal: AbortSignal | null | undefined }): Promise<Response> =>
        new Promise((_, reject) => {
          request.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      const slow = client([hang], { maxRetries: 0, timeout: 1_000 })
      const timeout = (
        await settle(slow.flashpi.invoices.create({} as never, { idempotencyKey: 'order-7' }))
      ).error
      expect(timeout).toBeInstanceOf(TimeoutError)
      expect((timeout as TimeoutError).idempotencyKey).toBe('order-7')
    })

    it('is not set on errors of other methods', async () => {
      const { flashpi } = client([problem(404, 'not_found')])
      const { error } = await settle(flashpi.documents.get(ID))
      expect((error as APIError).idempotencyKey).toBeUndefined()
    })

    it('comes from an Idempotency-Key header too, on every attempt', async () => {
      const { flashpi, sent } = client([problem(503, 'x'), json({}, 201)])
      await settle(
        flashpi.issuers.create({} as never, { headers: { 'Idempotency-Key': 'order-42' } }),
      )
      expect(sent.map((request) => request.headers.get('idempotency-key'))).toEqual([
        'order-42',
        'order-42',
      ])
    })
  })

  it('sends the same body on a retry when the caller changes the object afterwards', async () => {
    const { flashpi, sent } = client([new TypeError('reset'), json(documentBody(), 202)])
    const body = { items: [{ code: 'A' }] }
    const call = flashpi.invoices.create(body as never)
    body.items[0] = { code: 'B' }
    await settle(call)
    expect(sentJson(sent[0])).toEqual({ items: [{ code: 'A' }] })
    expect(sentJson(sent[1])).toEqual({ items: [{ code: 'A' }] })
  })
})

describe('ids that are dot segments', () => {
  it.each(['.', '..'])('refuses %j before sending anything', (id) => {
    const { flashpi, sent } = client([])
    expect(() => flashpi.issuers.establishments.delete(ID, id)).toThrow(/Invalid id/)
    expect(() => flashpi.issuers.establishments.emissionPoints.delete(ID, ID, id)).toThrow(
      /Invalid id/,
    )
    expect(() => flashpi.issuers.certificates.get(ID, id)).toThrow(/Invalid id/)
    expect(() => flashpi.webhookEndpoints.delete(id)).toThrow(/Invalid id/)
    expect(sent).toHaveLength(0)
  })

  it('sends ids that only contain dots, encoded', async () => {
    const { flashpi, sent } = client([json({}), json({})])
    await flashpi.documents.get('...')
    await flashpi.documents.get('%2e%2e')
    expect(sent.map((request) => request.url.pathname)).toEqual([
      '/v1/documents/...',
      '/v1/documents/%252e%252e',
    ])
  })
})

describe('options', () => {
  it('lets the request language win over a client Accept-Language header', async () => {
    const { flashpi, sent } = client([json({})], { defaultHeaders: { 'Accept-Language': 'es' } })
    await flashpi.status.get({ language: 'en' })
    expect(sent[0]?.headers.get('accept-language')).toBe('en')
  })

  it('refuses an Idempotency-Key in defaultHeaders', () => {
    expect(
      () => new Flashpi(TEST_KEY, { defaultHeaders: { 'IDEMPOTENCY-KEY': 'always-the-same' } }),
    ).toThrow(/defaultHeaders cannot carry an Idempotency-Key/)
  })

  it('refuses a client timeout setTimeout cannot hold', () => {
    expect(() => new Flashpi(TEST_KEY, { timeout: 2 ** 31 })).toThrow(/2147483647/)
    expect(() => new Flashpi(TEST_KEY, { timeout: Infinity })).toThrow(/timeout/)
    expect(new Flashpi(TEST_KEY, { timeout: 2 ** 31 - 1 }).environment).toBe('test')
  })

  it.each([0, -1, Number.NaN, Infinity, 2 ** 31])(
    'rejects a request timeout of %s before sending',
    async (timeout) => {
      const { flashpi, sent } = client([json({})])
      await expect(flashpi.status.get({ timeout })).rejects.toThrow(FlashpiError)
      expect(sent).toHaveLength(0)
    },
  )

  it.each([-1, 1.5, Number.NaN])('rejects request maxRetries of %s', async (maxRetries) => {
    const { flashpi, sent } = client([json({})])
    await expect(flashpi.status.get({ maxRetries })).rejects.toThrow(/maxRetries/)
    expect(sent).toHaveLength(0)
  })

  it('accepts explicit undefined options as the defaults', async () => {
    const { flashpi } = client([json({})], { timeout: undefined, language: undefined })
    await expect(
      flashpi.status.get({ timeout: undefined, maxRetries: undefined, idempotencyKey: undefined }),
    ).resolves.toEqual({})
  })
})

describe('the runtime checks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('allows a simulated DOM (jsdom, happy-dom) on a server runtime', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})
    expect(new Flashpi(TEST_KEY).environment).toBe('test')
  })

  it('refuses a browser: a DOM and no server runtime', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})
    const original = Object.getOwnPropertyDescriptor(globalThis, 'process')
    Object.defineProperty(globalThis, 'process', { value: undefined, configurable: true })
    try {
      expect(() => new Flashpi(TEST_KEY)).toThrow(/runs on servers only/)
    } finally {
      if (original) Object.defineProperty(globalThis, 'process', original)
    }
  })

  it('says when the runtime denies reading FLASHPI_API_KEY (Deno without --allow-env)', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'process')
    const denied = new Error('Requires env access to "FLASHPI_API_KEY"')
    Object.defineProperty(globalThis, 'process', {
      value: {
        versions: {},
        get env(): never {
          throw denied
        },
      },
      configurable: true,
    })
    try {
      expect(() => new Flashpi()).toThrow(/--allow-env=FLASHPI_API_KEY/)
    } finally {
      if (original) Object.defineProperty(globalThis, 'process', original)
    }
  })
})

describe('webhook hardening', () => {
  const secret = 'whsec_Zmxhc2hwaS1kb2NzLWV4YW1wbGUtc2VjcmV0LTMyLWI='
  const body =
    '{"id":"019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b","type":"invoice.authorized","environment":"test","createdAt":"2026-10-16T17:20:00.000Z"}'
  const valid = 'v1,HbWOpDPWCo3wtq41t9GVHUpg69M1zgvveoDJmSWkA8U='
  const headers = (signature: string): Record<string, string> => ({
    'webhook-id': '019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b',
    'webhook-timestamp': '1792152000',
    'webhook-signature': signature,
  })
  const now = 1792152000 * 1_000

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['tolerance NaN', { tolerance: Number.NaN, now }],
    ['tolerance -1', { tolerance: -1, now }],
    ['tolerance Infinity', { tolerance: Infinity, now }],
    ['an invalid Date as now', { now: new Date('not a date') }],
  ])('throws a TypeError for %s instead of skipping the time check', async (_case, options) => {
    await expect(verifyWebhookSignature(body, headers(valid), secret, options)).rejects.toThrow(
      TypeError,
    )
  })

  it('computes the HMAC once, however many signatures the header lists', async () => {
    const sign = vi.spyOn(crypto.subtle, 'sign')
    const decoys = Array.from(
      { length: 300 },
      () => 'v1,Ceo5qEr07ixe2NLpvHk3FH9bwy/WavXrAFQ/9tdO6mc=',
    )
    await expect(
      unwrapWebhook(body, headers([...decoys, valid].join(' ')), secret, { now }),
    ).resolves.toMatchObject({ type: 'invoice.authorized' })
    expect(sign).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a 6-byte key', 'whsec_Zmxhc2hw'],
    ['a placeholder', 'whsec_test'],
    ['a 65-byte key', `whsec_${btoa('x'.repeat(65))}`],
  ])('reports %s as invalid_secret', async (_case, badSecret) => {
    const error: unknown = await verifyWebhookSignature(body, headers(valid), badSecret, {
      now,
    }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(WebhookVerificationError)
    expect((error as WebhookVerificationError).reason).toBe('invalid_secret')
  })

  it('reports a bad secret before a stale timestamp', async () => {
    const error: unknown = await verifyWebhookSignature(body, headers(valid), 'whsec_test').catch(
      (reason: unknown) => reason,
    )
    expect((error as WebhookVerificationError).reason).toBe('invalid_secret')
  })

  it('accepts a 64-byte key', async () => {
    const key = new Uint8Array(64).fill(7)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const mac = new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        new TextEncoder().encode(`019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b.1792152000.${body}`),
      ),
    )
    const signature = `v1,${btoa(String.fromCharCode(...mac))}`
    const longSecret = `whsec_${btoa(String.fromCharCode(...key))}`
    await expect(
      verifyWebhookSignature(body, headers(signature), longSecret, { now }),
    ).resolves.toBeUndefined()
  })
})
