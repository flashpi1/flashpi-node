import { afterEach, describe, expect, it, vi } from 'vitest'

import { Flashpi, FlashpiError, VERSION } from '../src'
import { ID, LIVE_KEY, TEST_KEY, client, json, mockFetch, sentJson } from './support'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('new Flashpi()', () => {
  it('takes the key as the first argument and tells the environment from its prefix', () => {
    expect(new Flashpi(TEST_KEY).environment).toBe('test')
    expect(new Flashpi(LIVE_KEY).environment).toBe('live')
  })

  it('takes the key in the options object', () => {
    expect(new Flashpi({ apiKey: LIVE_KEY }).environment).toBe('live')
  })

  it('falls back to the FLASHPI_API_KEY environment variable', () => {
    vi.stubEnv('FLASHPI_API_KEY', LIVE_KEY)
    expect(new Flashpi().environment).toBe('live')
    expect(new Flashpi({ timeout: 1_000 }).environment).toBe('live')
  })

  it('prefers an explicit key over the environment variable', () => {
    vi.stubEnv('FLASHPI_API_KEY', LIVE_KEY)
    expect(new Flashpi(TEST_KEY).environment).toBe('test')
  })

  it('trims spaces around a pasted key', async () => {
    const { fetch, sent } = mockFetch(json({ status: 'operational' }))
    await new Flashpi(`  ${TEST_KEY}\n`, { fetch }).status.get()
    expect(sent[0]?.headers.get('authorization')).toBe(`Bearer ${TEST_KEY}`)
  })

  it('refuses a missing key', () => {
    vi.stubEnv('FLASHPI_API_KEY', '')
    expect(() => new Flashpi()).toThrow(/Missing API key/)
  })

  it('refuses a webhook secret passed as the key', () => {
    expect(() => new Flashpi('whsec_abc')).toThrow(/webhook signing secret/)
  })

  it('refuses a key without the fp_test_ or fp_live_ prefix', () => {
    expect(() => new Flashpi('sk_test_123')).toThrow(FlashpiError)
  })

  it('refuses to run in a browser', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})
    expect(() => new Flashpi(TEST_KEY)).toThrow(/runs on servers only/)
  })

  it('validates timeout and maxRetries', () => {
    expect(() => new Flashpi(TEST_KEY, { timeout: 0 })).toThrow(/timeout/)
    expect(() => new Flashpi(TEST_KEY, { timeout: Number.NaN })).toThrow(/timeout/)
    expect(() => new Flashpi(TEST_KEY, { maxRetries: -1 })).toThrow(/maxRetries/)
    expect(() => new Flashpi(TEST_KEY, { maxRetries: 1.5 })).toThrow(/maxRetries/)
  })

  it('uses the global fetch at call time, so later mocks still apply', async () => {
    const flashpi = new Flashpi(TEST_KEY)
    const { fetch, sent } = mockFetch(json({ status: 'operational' }))
    vi.stubGlobal('fetch', fetch)
    await flashpi.status.get()
    expect(sent).toHaveLength(1)
  })
})

describe('requests', () => {
  it('sends the key, JSON headers and the SDK version', async () => {
    const { flashpi, sent } = client([json({ id: ID })])
    await flashpi.issuers.get(ID)
    const request = sent[0]
    expect(request?.url.href).toBe(`https://api.flashpi.com.ec/v1/issuers/${ID}`)
    expect(request?.headers.get('authorization')).toBe(`Bearer ${TEST_KEY}`)
    expect(request?.headers.get('accept')).toBe('application/json')
    expect(request?.headers.get('user-agent')).toBe(`flashpi-node/${VERSION}`)
    expect(request?.headers.has('accept-language')).toBe(false)
    expect(request?.headers.has('idempotency-key')).toBe(false)
    expect(request?.headers.has('content-type')).toBe(false)
  })

  it('sends a JSON body with an Idempotency-Key on POST', async () => {
    const { flashpi, sent } = client([json({ id: ID }, 201)])
    await flashpi.issuers.create({ ruc: '0993411372001' } as never)
    const request = sent[0]
    expect(request?.method).toBe('POST')
    expect(request?.headers.get('content-type')).toBe('application/json')
    expect(request?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(sentJson(request)).toEqual({ ruc: '0993411372001' })
  })

  it('uses a fresh Idempotency-Key per call and the caller’s key when given', async () => {
    const { flashpi, sent } = client([json({}, 201), json({}, 201), json({}, 201)])
    await flashpi.issuers.create({} as never)
    await flashpi.issuers.create({} as never)
    await flashpi.issuers.create({} as never, { idempotencyKey: 'order-42' })
    const keys = sent.map((request) => request.headers.get('idempotency-key'))
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[2]).toBe('order-42')
  })

  it('never sends an Idempotency-Key on PATCH, DELETE or GET', async () => {
    const { flashpi, sent } = client([json({}), new Response(null, { status: 204 }), json({})])
    await flashpi.issuers.update(ID, {}, { idempotencyKey: 'ignored' })
    await flashpi.issuers.delete(ID, { idempotencyKey: 'ignored' })
    await flashpi.issuers.get(ID, { idempotencyKey: 'ignored' })
    expect(sent.map((request) => request.headers.has('idempotency-key'))).toEqual([
      false,
      false,
      false,
    ])
  })

  it('asks for the client language and lets a request override it', async () => {
    const { flashpi, sent } = client([json({}), json({})], { language: 'es' })
    await flashpi.status.get()
    await flashpi.status.get({ language: 'en' })
    expect(sent.map((request) => request.headers.get('accept-language'))).toEqual(['es', 'en'])
  })

  it('sends the correlation id and custom headers, but never replaces the key', async () => {
    const { flashpi, sent } = client([json({})], { defaultHeaders: { 'x-team': 'billing' } })
    await flashpi.status.get({
      correlationId: 'order-42',
      headers: { 'x-extra': 'yes', authorization: 'Bearer other' },
    })
    const headers = sent[0]?.headers
    expect(headers?.get('x-correlation-id')).toBe('order-42')
    expect(headers?.get('x-team')).toBe('billing')
    expect(headers?.get('x-extra')).toBe('yes')
    expect(headers?.get('authorization')).toBe(`Bearer ${TEST_KEY}`)
  })

  it('keeps a base URL path and drops its trailing slash', async () => {
    const { flashpi, sent } = client([json({})], { baseUrl: 'http://localhost:3000/proxy/' })
    await flashpi.status.get()
    expect(sent[0]?.url.href).toBe('http://localhost:3000/proxy/v1/status')
  })

  it('returns the data, and the response and request id with withResponse()', async () => {
    const { flashpi } = client([json({ id: ID }, 200, { 'x-request-id': 'req_abc' })])
    const { data, response, requestId } = await flashpi.issuers.get(ID).withResponse()
    expect(data).toEqual({ id: ID })
    expect(response.status).toBe(200)
    expect(requestId).toBe('req_abc')
  })

  it('works as a promise: then, catch and finally', async () => {
    const { flashpi } = client([json({ id: ID }), json({ id: ID })])
    const done = vi.fn()
    await expect(flashpi.issuers.get(ID).finally(done)).resolves.toEqual({ id: ID })
    expect(done).toHaveBeenCalledOnce()
    const failing = client([new Response('nope', { status: 404 })], { maxRetries: 0 }).flashpi
    await expect(failing.issuers.get(ID).catch(() => 'caught')).resolves.toBe('caught')
    expect(Object.prototype.toString.call(flashpi.issuers.get(ID))).toBe('[object APIPromise]')
  })

  it('rejects an empty path id before sending anything', () => {
    const { flashpi, sent } = client([])
    expect(() => flashpi.issuers.get('')).toThrow(/Missing id/)
    expect(() => flashpi.documents.get('  ')).toThrow(/Missing id/)
    expect(sent).toHaveLength(0)
  })

  it('encodes path ids', async () => {
    const { flashpi, sent } = client([json({})])
    await flashpi.issuers.get('a/b?c')
    expect(sent[0]?.url.pathname).toBe('/v1/issuers/a%2Fb%3Fc')
  })

  it('throws a FlashpiError when a success body is not JSON', async () => {
    const { flashpi, sent } = client([new Response('<html>', { status: 200 })])
    await expect(flashpi.status.get()).rejects.toThrow(/not JSON/)
    expect(sent).toHaveLength(1)
  })
})
