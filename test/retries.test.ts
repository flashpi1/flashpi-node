import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  APIError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ConnectionError,
  FlashpiError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  TimeoutError,
  UnprocessableEntityError,
} from '../src'
import { ID, OTHER_ID, client, documentBody, json, problem } from './support'

beforeEach(() => {
  vi.useFakeTimers()
  // No jitter: every backoff is the full delay.
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Settles a call while running the timers its retries wait on. */
async function settle<T>(promise: PromiseLike<T>): Promise<{ value?: T; error?: unknown }> {
  const outcome = Promise.resolve(promise).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
  await vi.runAllTimersAsync()
  return outcome
}

const networkError = (): TypeError => new TypeError('fetch failed')

describe('errors', () => {
  it.each([
    [400, 'malformed_json', BadRequestError],
    [401, 'invalid_api_key', AuthenticationError],
    [403, 'key_read_only', PermissionDeniedError],
    [404, 'not_found', NotFoundError],
    [409, 'sequential_already_used', ConflictError],
    [413, 'payload_too_large', APIError],
    [422, 'validation_failed', UnprocessableEntityError],
  ])('maps %i %s to its class and does not retry it', async (status, code, ErrorClass) => {
    const { flashpi, sent } = client([problem(status, code)])
    const { error } = await settle(flashpi.invoices.create({} as never))
    expect(error).toBeInstanceOf(ErrorClass)
    expect(error).toBeInstanceOf(APIError)
    expect(error).toBeInstanceOf(FlashpiError)
    expect(sent).toHaveLength(1)
  })

  it('exposes the Problem Details members and extensions', async () => {
    const { flashpi } = client([
      problem(422, 'total_mismatch', {
        errors: [{ field: 'items[0].quantity', code: 'out_of_range', message: 'Too big' }],
        expectedTotal: '10.00',
        computedTotal: '11.50',
      }),
    ])
    const { error } = await settle(flashpi.invoices.create({} as never))
    expect(error).toMatchObject({
      name: 'UnprocessableEntityError',
      status: 422,
      code: 'total_mismatch',
      title: 'Problem',
      detail: 'Detail of total_mismatch',
      requestId: 'req_problem',
      errors: [{ field: 'items[0].quantity', code: 'out_of_range', message: 'Too big' }],
      message: '422 total_mismatch: Detail of total_mismatch',
    })
    const apiError = error as APIError
    expect(apiError.problem?.expectedTotal).toBe('10.00')
    expect(apiError.headers.get('content-type')).toContain('problem+json')
  })

  it('handles an error body that is not Problem Details (a firewall or proxy answer)', async () => {
    const { flashpi } = client([
      new Response('<html><body>403 Forbidden</body></html>', {
        status: 403,
        headers: { 'x-request-id': 'edge_1' },
      }),
    ])
    const { error } = await settle(flashpi.status.get())
    expect(error).toBeInstanceOf(PermissionDeniedError)
    expect(error).toMatchObject({ code: null, detail: null, errors: [], requestId: 'edge_1' })
    expect((error as Error).message).toBe('403 <html><body>403 Forbidden</body></html>')
  })

  it('describes an empty error body', async () => {
    const { flashpi } = client([new Response(null, { status: 404 })])
    const { error } = await settle(flashpi.status.get())
    expect((error as Error).message).toBe('404 (no response body)')
  })
})

describe('retries', () => {
  it('retries a 500 with the same Idempotency-Key, waiting 0.5 s then 1 s', async () => {
    const { flashpi, sent } = client([
      problem(500, 'internal_error'),
      problem(502, 'internal_error'),
      json(documentBody(), 202),
    ])
    const started = Date.now()
    const { value } = await settle(flashpi.invoices.create({} as never))
    expect(value).toMatchObject({ id: ID })
    expect(sent).toHaveLength(3)
    const keys = new Set(sent.map((request) => request.headers.get('idempotency-key')))
    expect(keys.size).toBe(1)
    expect(Date.now() - started).toBe(1_500)
  })

  it('throws the last error once the retries run out', async () => {
    const { flashpi, sent } = client([
      problem(503, 'service_unavailable'),
      problem(503, 'service_unavailable'),
      problem(503, 'service_unavailable'),
    ])
    const { error } = await settle(flashpi.status.get())
    expect(error).toBeInstanceOf(InternalServerError)
    expect(sent).toHaveLength(3)
  })

  it('honors maxRetries from the client and from the request', async () => {
    const first = client([problem(500, 'internal_error')], { maxRetries: 0 })
    expect((await settle(first.flashpi.status.get())).error).toBeInstanceOf(InternalServerError)
    expect(first.sent).toHaveLength(1)

    const second = client([problem(500, 'internal_error'), json({})], { maxRetries: 0 })
    expect((await settle(second.flashpi.status.get({ maxRetries: 1 }))).value).toEqual({})
    expect(second.sent).toHaveLength(2)
  })

  it('retries network errors and wraps the last one in a ConnectionError', async () => {
    const { flashpi, sent } = client([networkError(), networkError(), networkError()])
    const { error } = await settle(flashpi.documents.get(ID))
    expect(error).toBeInstanceOf(ConnectionError)
    expect((error as Error).message).toContain('fetch failed')
    expect((error as Error).cause).toBeInstanceOf(TypeError)
    expect(sent).toHaveLength(3)
  })

  it('times out a slow attempt and retries it', async () => {
    const hang = (request: { signal: AbortSignal | null | undefined }): Promise<Response> =>
      new Promise((_, reject) => {
        request.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    const { flashpi, sent } = client([hang, json({ ok: true })], { timeout: 1_000 })
    const started = Date.now()
    const { value } = await settle(flashpi.status.get())
    expect(value).toEqual({ ok: true })
    expect(sent).toHaveLength(2)
    expect(Date.now() - started).toBe(1_500)
  })

  it('throws a TimeoutError when every attempt times out', async () => {
    const hang = (request: { signal: AbortSignal | null | undefined }): Promise<Response> =>
      new Promise((_, reject) => {
        request.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    const { flashpi } = client([hang], { timeout: 2_000, maxRetries: 0 })
    const { error } = await settle(flashpi.status.get())
    expect(error).toBeInstanceOf(TimeoutError)
    expect(error).toBeInstanceOf(ConnectionError)
    expect((error as Error).message).toMatch(/timed out after 2000 ms/)
  })

  it('waits a short Retry-After of a 429', async () => {
    const { flashpi, sent } = client([
      problem(429, 'rate_limited', {}, { 'retry-after': '3' }),
      json({}),
    ])
    const started = Date.now()
    await settle(flashpi.status.get())
    expect(sent).toHaveLength(2)
    expect(Date.now() - started).toBe(3_000)
  })

  it('does not wait for a daily quota and reports when it resets', async () => {
    const { flashpi, sent } = client([
      problem(
        429,
        'demo_issuer_quota_exceeded',
        { limit: 50, resetsAt: '2026-11-13T05:00:00.000Z' },
        { 'retry-after': '40000' },
      ),
    ])
    const { error } = await settle(flashpi.invoices.create({} as never))
    expect(error).toBeInstanceOf(RateLimitError)
    const rateLimit = error as RateLimitError
    expect(rateLimit.retryAfter).toBe(40_000)
    expect(rateLimit.problem?.limit).toBe(50)
    expect(sent).toHaveLength(1)
  })

  it('reads a Retry-After given as an HTTP date', async () => {
    const at = new Date(Date.now() + 2_000).toUTCString()
    const { flashpi, sent } = client([problem(503, 'x', {}, { 'retry-after': at }), json({})])
    await settle(flashpi.status.get())
    expect(sent).toHaveLength(2)
  })

  it('retries a 409 idempotency_key_in_progress after at least a second', async () => {
    const { flashpi, sent } = client([
      problem(409, 'idempotency_key_in_progress'),
      json(documentBody(), 202, { 'idempotent-replayed': 'true' }),
    ])
    const started = Date.now()
    const { value } = await settle(flashpi.invoices.create({} as never))
    expect(value).toMatchObject({ id: ID })
    expect(sent).toHaveLength(2)
    expect(Date.now() - started).toBe(1_000)
  })

  it('does not retry the missing demo certificate (503 demo_issuer_unavailable)', async () => {
    const { flashpi, sent } = client([problem(503, 'demo_issuer_unavailable')])
    const { error } = await settle(flashpi.invoices.create({} as never))
    expect(error).toBeInstanceOf(InternalServerError)
    expect(sent).toHaveLength(1)
  })

  it('does not retry a 501', async () => {
    const { flashpi, sent } = client([new Response('', { status: 501 })])
    await settle(flashpi.status.get())
    expect(sent).toHaveLength(1)
  })

  it('caps the backoff at 8 seconds', async () => {
    const replies = Array.from({ length: 6 }, () => problem(500, 'internal_error'))
    const { flashpi } = client([...replies, json({})], { maxRetries: 6 })
    const started = Date.now()
    await settle(flashpi.status.get())
    // 0.5 + 1 + 2 + 4 + 8 + 8
    expect(Date.now() - started).toBe(23_500)
  })
})

describe('recovering a document created by an earlier attempt', () => {
  it('returns the document when a retry finds its Idempotency-Key used by it', async () => {
    const { flashpi, sent } = client([
      problem(500, 'internal_error'),
      problem(422, 'idempotency_key_reused', { documentId: OTHER_ID }),
      json(documentBody(OTHER_ID, 'authorized')),
    ])
    const { value } = await settle(flashpi.invoices.create({} as never, { language: 'es' }))
    expect(value).toMatchObject({ id: OTHER_ID, status: 'authorized' })
    expect(sent.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      'POST /v1/invoices',
      'POST /v1/invoices',
      `GET /v1/documents/${OTHER_ID}`,
    ])
    expect(sent[2]?.headers.has('idempotency-key')).toBe(false)
    expect(sent[2]?.headers.get('accept-language')).toBe('es')
  })

  it('throws the reuse on the first attempt: the caller reused a key', async () => {
    const { flashpi, sent } = client([
      problem(422, 'idempotency_key_reused', { documentId: OTHER_ID }),
    ])
    const { error } = await settle(
      flashpi.invoices.create({} as never, { idempotencyKey: 'used-before' }),
    )
    expect(error).toMatchObject({ code: 'idempotency_key_reused' })
    expect(sent).toHaveLength(1)
  })

  it('throws a reuse without documentId (same key, different request)', async () => {
    const { flashpi, sent } = client([
      new TypeError('fetch failed'),
      problem(422, 'idempotency_key_reused'),
    ])
    const { error } = await settle(flashpi.creditNotes.create({} as never))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(sent).toHaveLength(2)
  })

  it('does not apply to other POSTs', async () => {
    const { flashpi, sent } = client([
      problem(500, 'internal_error'),
      problem(422, 'idempotency_key_reused', { documentId: OTHER_ID }),
    ])
    const { error } = await settle(flashpi.issuers.create({} as never))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(sent).toHaveLength(2)
  })
})

describe('DELETE retried after a lost answer', () => {
  it('treats a 404 on a retry as done', async () => {
    const { flashpi, sent } = client([new TypeError('socket hang up'), problem(404, 'not_found')])
    const { value, error } = await settle(flashpi.webhookEndpoints.delete(ID))
    expect(error).toBeUndefined()
    expect(value).toBeUndefined()
    expect(sent).toHaveLength(2)
  })

  it('throws a 404 on the first attempt', async () => {
    const { flashpi } = client([problem(404, 'not_found')])
    const { error } = await settle(flashpi.webhookEndpoints.delete(ID))
    expect(error).toBeInstanceOf(NotFoundError)
  })
})

describe('cancelling', () => {
  it('rejects with the signal’s reason before sending', async () => {
    const { flashpi, sent } = client([json({})])
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    const { error } = await settle(flashpi.status.get({ signal: controller.signal }))
    expect(error).toEqual(new Error('stop'))
    expect(sent).toHaveLength(0)
  })

  it('aborts a request in flight and does not retry it', async () => {
    const controller = new AbortController()
    const hang = (request: { signal: AbortSignal | null | undefined }): Promise<Response> =>
      new Promise((_, reject) => {
        request.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
        setTimeout(() => {
          controller.abort(new Error('user stop'))
        }, 100)
      })
    const { flashpi, sent } = client([hang])
    const { error } = await settle(flashpi.status.get({ signal: controller.signal }))
    expect(error).toEqual(new Error('user stop'))
    expect(sent).toHaveLength(1)
  })

  it('stops waiting between retries', async () => {
    const controller = new AbortController()
    const { flashpi, sent } = client([
      () => {
        setTimeout(() => {
          controller.abort(new Error('user stop'))
        }, 100)
        return problem(500, 'internal_error')
      },
    ])
    const { error } = await settle(flashpi.status.get({ signal: controller.signal }))
    expect(error).toEqual(new Error('user stop'))
    expect(sent).toHaveLength(1)
  })
})
