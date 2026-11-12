import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConflictError, type Flashpi } from '../src'
import { client, documentBody, json, page, problem, sentJson } from './support'

const I = 'iss_1'
const E = 'est_1'
const P = 'pt_1'
const C = 'cert_1'
const O = 'onb_1'
const D = 'doc_1'
const W = 'whe_1'
const L = 'del_1'
const V = 'evt_1'

interface Case {
  name: string
  call: (flashpi: Flashpi) => PromiseLike<unknown>
  method: string
  path: string
  body?: unknown
  reply?: Response
}

const cases: Case[] = [
  { name: 'status.get', call: (f) => f.status.get(), method: 'GET', path: '/v1/status' },
  {
    name: 'issuers.create',
    call: (f) => f.issuers.create({ ruc: '1' } as never),
    method: 'POST',
    path: '/v1/issuers',
    body: { ruc: '1' },
  },
  {
    name: 'issuers.list',
    call: (f) => f.issuers.list(),
    method: 'GET',
    path: '/v1/issuers',
    reply: page([]),
  },
  { name: 'issuers.get', call: (f) => f.issuers.get(I), method: 'GET', path: `/v1/issuers/${I}` },
  {
    name: 'issuers.update',
    call: (f) => f.issuers.update(I, { tradeName: 'X' }),
    method: 'PATCH',
    path: `/v1/issuers/${I}`,
    body: { tradeName: 'X' },
  },
  {
    name: 'issuers.delete',
    call: (f) => f.issuers.delete(I),
    method: 'DELETE',
    path: `/v1/issuers/${I}`,
    reply: new Response(null, { status: 204 }),
  },
  {
    name: 'establishments.create',
    call: (f) => f.issuers.establishments.create(I, { code: '002' } as never),
    method: 'POST',
    path: `/v1/issuers/${I}/establishments`,
    body: { code: '002' },
  },
  {
    name: 'establishments.list',
    call: (f) => f.issuers.establishments.list(I),
    method: 'GET',
    path: `/v1/issuers/${I}/establishments`,
    reply: page([]),
  },
  {
    name: 'establishments.get',
    call: (f) => f.issuers.establishments.get(I, E),
    method: 'GET',
    path: `/v1/issuers/${I}/establishments/${E}`,
  },
  {
    name: 'establishments.update',
    call: (f) => f.issuers.establishments.update(I, E, { address: 'Quito' }),
    method: 'PATCH',
    path: `/v1/issuers/${I}/establishments/${E}`,
    body: { address: 'Quito' },
  },
  {
    name: 'establishments.delete',
    call: (f) => f.issuers.establishments.delete(I, E),
    method: 'DELETE',
    path: `/v1/issuers/${I}/establishments/${E}`,
    reply: new Response(null, { status: 204 }),
  },
  {
    name: 'emissionPoints.create',
    call: (f) => f.issuers.establishments.emissionPoints.create(I, E, { code: '002' }),
    method: 'POST',
    path: `/v1/issuers/${I}/establishments/${E}/emission-points`,
    body: { code: '002' },
  },
  {
    name: 'emissionPoints.list',
    call: (f) => f.issuers.establishments.emissionPoints.list(I, E),
    method: 'GET',
    path: `/v1/issuers/${I}/establishments/${E}/emission-points`,
    reply: page([]),
  },
  {
    name: 'emissionPoints.get',
    call: (f) => f.issuers.establishments.emissionPoints.get(I, E, P),
    method: 'GET',
    path: `/v1/issuers/${I}/establishments/${E}/emission-points/${P}`,
  },
  {
    name: 'emissionPoints.delete',
    call: (f) => f.issuers.establishments.emissionPoints.delete(I, E, P),
    method: 'DELETE',
    path: `/v1/issuers/${I}/establishments/${E}/emission-points/${P}`,
    reply: new Response(null, { status: 204 }),
  },
  {
    name: 'certificates.list',
    call: (f) => f.issuers.certificates.list(I),
    method: 'GET',
    path: `/v1/issuers/${I}/certificates`,
    reply: page([]),
  },
  {
    name: 'certificates.get',
    call: (f) => f.issuers.certificates.get(I, C),
    method: 'GET',
    path: `/v1/issuers/${I}/certificates/${C}`,
  },
  {
    name: 'issuerOnboardings.get',
    call: (f) => f.issuerOnboardings.get(O),
    method: 'GET',
    path: `/v1/issuer-onboardings/${O}`,
  },
  {
    name: 'issuerOnboardings.complete (empty body by default)',
    call: (f) => f.issuerOnboardings.complete(O),
    method: 'POST',
    path: `/v1/issuer-onboardings/${O}/complete`,
    body: {},
  },
  {
    name: 'invoices.create',
    call: (f) => f.invoices.create({ a: 1 } as never),
    method: 'POST',
    path: '/v1/invoices',
    body: { a: 1 },
  },
  {
    name: 'creditNotes.create',
    call: (f) => f.creditNotes.create({ a: 1 } as never),
    method: 'POST',
    path: '/v1/credit-notes',
    body: { a: 1 },
  },
  {
    name: 'debitNotes.create',
    call: (f) => f.debitNotes.create({ a: 1 } as never),
    method: 'POST',
    path: '/v1/debit-notes',
    body: { a: 1 },
  },
  {
    name: 'purchaseSettlements.create',
    call: (f) => f.purchaseSettlements.create({ a: 1 } as never),
    method: 'POST',
    path: '/v1/purchase-settlements',
    body: { a: 1 },
  },
  {
    name: 'waybills.create',
    call: (f) => f.waybills.create({ a: 1 } as never),
    method: 'POST',
    path: '/v1/waybills',
    body: { a: 1 },
  },
  {
    name: 'withholdings.create',
    call: (f) => f.withholdings.create({ a: 1 } as never),
    method: 'POST',
    path: '/v1/withholdings',
    body: { a: 1 },
  },
  {
    name: 'documents.list',
    call: (f) => f.documents.list(),
    method: 'GET',
    path: '/v1/documents',
    reply: page([]),
  },
  {
    name: 'documents.get',
    call: (f) => f.documents.get(D),
    method: 'GET',
    path: `/v1/documents/${D}`,
  },
  {
    name: 'documents.sendEmail',
    call: (f) => f.documents.sendEmail(D),
    method: 'POST',
    path: `/v1/documents/${D}/email`,
    body: {},
  },
  {
    name: 'webhookEndpoints.create',
    call: (f) => f.webhookEndpoints.create({ url: 'https://x' } as never),
    method: 'POST',
    path: '/v1/webhook-endpoints',
    body: { url: 'https://x' },
  },
  {
    name: 'webhookEndpoints.list',
    call: (f) => f.webhookEndpoints.list(),
    method: 'GET',
    path: '/v1/webhook-endpoints',
    reply: page([]),
  },
  {
    name: 'webhookEndpoints.get',
    call: (f) => f.webhookEndpoints.get(W),
    method: 'GET',
    path: `/v1/webhook-endpoints/${W}`,
  },
  {
    name: 'webhookEndpoints.update',
    call: (f) => f.webhookEndpoints.update(W, { disabled: true }),
    method: 'PATCH',
    path: `/v1/webhook-endpoints/${W}`,
    body: { disabled: true },
  },
  {
    name: 'webhookEndpoints.delete',
    call: (f) => f.webhookEndpoints.delete(W),
    method: 'DELETE',
    path: `/v1/webhook-endpoints/${W}`,
    reply: new Response(null, { status: 204 }),
  },
  {
    name: 'webhookEndpoints.getSecret',
    call: (f) => f.webhookEndpoints.getSecret(W),
    method: 'GET',
    path: `/v1/webhook-endpoints/${W}/secret`,
  },
  {
    name: 'webhookEndpoints.rotateSecret',
    call: (f) => f.webhookEndpoints.rotateSecret(W, { previousSecretExpiresInHours: 0 }),
    method: 'POST',
    path: `/v1/webhook-endpoints/${W}/rotate-secret`,
    body: { previousSecretExpiresInHours: 0 },
  },
  {
    name: 'webhookEndpoints.rotateSecret (no body)',
    call: (f) => f.webhookEndpoints.rotateSecret(W),
    method: 'POST',
    path: `/v1/webhook-endpoints/${W}/rotate-secret`,
  },
  {
    name: 'webhookEndpoints.verify',
    call: (f) => f.webhookEndpoints.verify(W),
    method: 'POST',
    path: `/v1/webhook-endpoints/${W}/verify`,
  },
  {
    name: 'deliveries.list',
    call: (f) => f.webhookEndpoints.deliveries.list(W, { status: 'failed' }),
    method: 'GET',
    path: `/v1/webhook-endpoints/${W}/deliveries`,
    reply: page([]),
  },
  {
    name: 'deliveries.get',
    call: (f) => f.webhookEndpoints.deliveries.get(W, L),
    method: 'GET',
    path: `/v1/webhook-endpoints/${W}/deliveries/${L}`,
  },
  {
    name: 'deliveries.replay',
    call: (f) => f.webhookEndpoints.deliveries.replay(W, L),
    method: 'POST',
    path: `/v1/webhook-endpoints/${W}/deliveries/${L}/replay`,
  },
  {
    name: 'events.list',
    call: (f) => f.events.list({ documentId: D }),
    method: 'GET',
    path: '/v1/events',
    reply: page([]),
  },
  { name: 'events.get', call: (f) => f.events.get(V), method: 'GET', path: `/v1/events/${V}` },
]

describe('every operation', () => {
  it.each(cases)('$name → $method $path', async ({ call, method, path, body, reply }) => {
    const { flashpi, sent } = client([reply ?? json({})])
    await call(flashpi)
    const request = sent[0]
    expect(request?.method).toBe(method)
    expect(request?.url.pathname).toBe(path)
    if (body === undefined) {
      expect(request?.body).toBeUndefined()
      expect(request?.headers.has('content-type')).toBe(false)
    } else {
      expect(sentJson(request)).toEqual(body)
    }
    expect(request?.headers.has('idempotency-key')).toBe(method === 'POST')
  })

  it('covers the 45 operations of the API', () => {
    // certificates.upload, issuerOnboardings.create, documents.xml and documents.pdf have
    // their own tests below.
    const operations = new Set(cases.map(({ method, path }) => `${method} ${path}`))
    expect(operations.size + 4).toBe(45)
  })
})

describe('issuing documents', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the document of a 200 (sync mode, settled) and of a 202', async () => {
    const { flashpi } = client([json(documentBody(D, 'authorized')), json(documentBody(D), 202)])
    await expect(flashpi.invoices.create({} as never)).resolves.toMatchObject({
      status: 'authorized',
    })
    await expect(flashpi.invoices.create({} as never)).resolves.toMatchObject({
      status: 'processing',
    })
  })

  it('waits for the SRI longer than the client timeout in sync mode', async () => {
    vi.useFakeTimers()
    const slow = (): Promise<Response> =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(json(documentBody(D, 'authorized')))
        }, 20_000)
      })
    const { flashpi } = client([slow], { timeout: 5_000, maxRetries: 0 })
    const result = flashpi.invoices.create({
      options: { waitForAuthorization: true, waitTimeoutSeconds: 10 },
    } as never)
    const settled = Promise.resolve(result).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await settled).toMatchObject({ value: { status: 'authorized' } })
  })

  it('keeps the client timeout when not waiting', async () => {
    vi.useFakeTimers()
    const slow = (request: { signal: AbortSignal | null | undefined }): Promise<Response> =>
      new Promise((resolve, reject) => {
        request.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
        setTimeout(() => {
          resolve(json({}))
        }, 20_000)
      })
    const { flashpi } = client([slow], { timeout: 5_000, maxRetries: 0 })
    const settled = Promise.resolve(flashpi.invoices.create({} as never)).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await settled).toMatchObject({ error: { name: 'TimeoutError' } })
  })
})

describe('documents', () => {
  it('returns the XML and which stage it is', async () => {
    const { flashpi, sent } = client([
      new Response('<autorizacion/>', {
        headers: { 'content-type': 'application/xml', 'flashpi-xml-kind': 'authorized' },
      }),
      new Response('<factura/>', { headers: { 'content-type': 'application/xml' } }),
    ])
    await expect(flashpi.documents.xml(D)).resolves.toEqual({
      xml: '<autorizacion/>',
      kind: 'authorized',
    })
    expect(sent[0]?.url.pathname).toBe(`/v1/documents/${D}/xml`)
    expect(sent[0]?.headers.get('accept')).toBe('application/xml, application/problem+json')
    const { data, requestId } = await flashpi.documents.xml(D).withResponse()
    expect(data.kind).toBeNull()
    expect(requestId).toBeNull()
  })

  it('returns the RIDE as bytes', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    const { flashpi, sent } = client([
      new Response(pdf, { headers: { 'content-type': 'application/pdf' } }),
    ])
    const bytes = await flashpi.documents.pdf(D)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect([...bytes]).toEqual([...pdf])
    expect(sent[0]?.url.pathname).toBe(`/v1/documents/${D}/pdf`)
    expect(sent[0]?.headers.get('accept')).toBe('application/pdf, application/problem+json')
  })

  it('throws ride_not_available as a ConflictError with the RIDE status', async () => {
    const { flashpi } = client([problem(409, 'ride_not_available', { rideStatus: 'pending' })])
    const error: unknown = await flashpi.documents.pdf(D).then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).problem?.rideStatus).toBe('pending')
  })
})

describe('.p12 uploads', () => {
  const p12 = new Uint8Array([0x30, 0x82, 0x01, 0x02])

  function sentForm(request: { body: unknown } | undefined): FormData {
    if (!(request?.body instanceof FormData)) throw new Error('Not a multipart body')
    return request.body
  }

  it('uploads a certificate as multipart with the file and the password', async () => {
    const { flashpi, sent } = client([json({ id: C, status: 'pending' }, 202)])
    await flashpi.issuers.certificates.upload(I, { file: p12, password: 'secret' })
    const request = sent[0]
    expect(request?.method).toBe('POST')
    expect(request?.url.pathname).toBe(`/v1/issuers/${I}/certificates`)
    expect(request?.headers.has('content-type')).toBe(false)
    expect(request?.headers.has('idempotency-key')).toBe(true)
    const form = sentForm(request)
    expect([...form.keys()]).toEqual(['file', 'password'])
    expect(form.get('password')).toBe('secret')
    const file = form.get('file') as File
    expect(file.name).toBe('certificate.p12')
    expect(file.type).toBe('application/x-pkcs12')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(p12)
  })

  it('starts an onboarding with a Blob or an ArrayBuffer and a file name', async () => {
    const { flashpi, sent } = client([json({ id: O }, 202), json({ id: O }, 202)])
    await flashpi.issuerOnboardings.create({
      file: new Blob([p12]),
      password: 'x',
      filename: 'firma.p12',
    })
    await flashpi.issuerOnboardings.create({ file: p12.buffer, password: 'x' })
    expect(sent.map((request) => request.url.pathname)).toEqual([
      '/v1/issuer-onboardings',
      '/v1/issuer-onboardings',
    ])
    expect((sentForm(sent[0]).get('file') as File).name).toBe('firma.p12')
    expect((sentForm(sent[1]).get('file') as File).size).toBe(4)
  })

  it('sends the same file again on a retry', async () => {
    vi.useFakeTimers()
    const { flashpi, sent } = client([problem(500, 'internal_error'), json({ id: C }, 202)])
    const result = Promise.resolve(
      flashpi.issuers.certificates.upload(I, { file: p12, password: 'x' }),
    )
    await vi.runAllTimersAsync()
    await result
    vi.useRealTimers()
    expect(sent).toHaveLength(2)
    expect(sent[0]?.headers.get('idempotency-key')).toBe(sent[1]?.headers.get('idempotency-key'))
    const second = sentForm(sent[1]).get('file') as File
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(p12)
  })

  it('rejects an empty file, a file over 1 MiB and a missing password before sending', () => {
    const { flashpi, sent } = client([])
    expect(() =>
      flashpi.issuers.certificates.upload(I, { file: new Uint8Array(), password: 'x' }),
    ).toThrow(/empty/)
    expect(() =>
      flashpi.issuers.certificates.upload(I, { file: new Uint8Array(1_048_577), password: 'x' }),
    ).toThrow(/1048576/)
    expect(() =>
      flashpi.issuerOnboardings.create({ file: p12, password: undefined as unknown as string }),
    ).toThrow(/password/)
    expect(sent).toHaveLength(0)
  })
})
