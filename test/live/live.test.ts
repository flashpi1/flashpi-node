/**
 * The SDK against the real Flashpi API in test mode (SRI pruebas): `pnpm test:live`.
 *
 * Needs FLASHPI_TEST_API_KEY (an fp_test_ key with read_write access) and
 * FLASHPI_DEMO_ISSUER_ID (the demo issuer's id, on the console's Overview). It issues ONE real
 * test invoice on the shared demo issuer, which counts toward its daily quota of 50, so CI only
 * runs it while a release is being prepared. It never accepts an fp_live_ key.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import {
  ConflictError,
  type Document,
  Flashpi,
  NotFoundError,
  UnprocessableEntityError,
} from '../../src'

const apiKey = process.env.FLASHPI_TEST_API_KEY ?? ''
const issuerId = process.env.FLASHPI_DEMO_ISSUER_ID ?? ''
const baseUrl = process.env.FLASHPI_BASE_URL

const configured = apiKey !== '' && issuerId !== ''

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** The same test invoice as the docs' quickstart: USD 1.00 + 15 % VAT to the SRI's test RUC. */
function testInvoice(): Parameters<Flashpi['invoices']['create']>[0] {
  return {
    issuerId,
    establishment: '001',
    emissionPoint: '001',
    customer: {
      idType: 'ruc',
      id: '1760013210001',
      name: 'PRUEBAS SERVICIO DE RENTAS INTERNAS',
      address: 'AMAZONAS AVENUE AND VILLALENGUA, QUITO',
    },
    items: [
      {
        code: 'SDK-LIVE-001',
        description: '@flashpi/node live test',
        quantity: '1',
        unitPrice: '1.00',
        taxes: [{ type: 'vat', rate: '15' }],
      },
    ],
    payments: [{ method: 'cash', amount: '1.15' }],
    options: { waitForAuthorization: true, waitTimeoutSeconds: 30, sendEmail: false },
  }
}

describe.skipIf(!configured)('the live API in test mode', () => {
  let flashpi: Flashpi
  let invoice: Document
  const idempotencyKey = `sdk-live-${Date.now().toString(36)}-${crypto.randomUUID()}`

  beforeAll(() => {
    if (!apiKey.startsWith('fp_test_')) {
      throw new Error('FLASHPI_TEST_API_KEY must be an fp_test_ key: this suite never runs live')
    }
    flashpi = new Flashpi(apiKey, baseUrl ? { baseUrl } : {})
  })

  it('reads the API status', async () => {
    await expect(flashpi.status.get()).resolves.toEqual({ status: 'operational' })
  })

  it('rejects an invalid invoice with field errors, in Spanish when asked', async () => {
    const body = { ...testInvoice(), items: [] }
    const error: unknown = await flashpi.invoices
      .create(body, { language: 'es', maxRetries: 0 })
      .then(
        () => null,
        (reason: unknown) => reason,
      )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    const problem = error as UnprocessableEntityError
    expect(problem.code).toBe('validation_failed')
    expect(problem.errors.length).toBeGreaterThan(0)
    expect(problem.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(problem.headers.get('content-language')).toBe('es')
  })

  it('issues a test invoice and waits for the SRI', async () => {
    const { data, response, requestId } = await flashpi.invoices
      .create(testInvoice(), { idempotencyKey, correlationId: 'flashpi-node-live' })
      .withResponse()
    expect([200, 202]).toContain(response.status)
    expect(requestId).toBeTruthy()
    expect(data.type).toBe('invoice')
    expect(data.environment).toBe('test')
    invoice = data

    // The SRI's test environment can be slow: follow the document for up to 2 minutes.
    for (
      let poll = 0;
      poll < 24 && ['processing', 'pending_sri'].includes(invoice.status);
      poll++
    ) {
      await sleep(5_000)
      invoice = await flashpi.documents.get(invoice.id)
    }
    expect(invoice.status).toBe('authorized')
    expect(invoice.accessKey).toMatch(/^\d{49}$/)
  })

  it('replays the same Idempotency-Key instead of issuing again', async () => {
    const { data, response } = await flashpi.invoices
      .create(testInvoice(), { idempotencyKey })
      .withResponse()
    expect(data.id).toBe(invoice.id)
    expect(response.headers.get('idempotent-replayed')).toBe('true')
  })

  it('finds the document by its access key', async () => {
    const page = await flashpi.documents.list({ accessKey: invoice.accessKey, limit: 5 })
    expect(page.data.map((document) => document.id)).toEqual([invoice.id])
  })

  it('downloads the authorized XML', async () => {
    const { xml, kind } = await flashpi.documents.xml(invoice.id)
    expect(kind).toBe('authorized')
    expect(xml).toContain(invoice.accessKey)
  })

  it('downloads the RIDE once it is generated', async () => {
    let pdf: Uint8Array | null = null
    for (let poll = 0; poll < 24 && !pdf; poll++) {
      try {
        pdf = await flashpi.documents.pdf(invoice.id)
      } catch (error) {
        if (!(error instanceof ConflictError) || error.code !== 'ride_not_available') throw error
        await sleep(5_000)
      }
    }
    expect(pdf).not.toBeNull()
    expect(new TextDecoder().decode(pdf?.slice(0, 5))).toBe('%PDF-')
  })

  it('lists the events of the document', async () => {
    const types: string[] = []
    for (let poll = 0; poll < 12 && !types.includes('invoice.authorized'); poll++) {
      if (poll > 0) await sleep(5_000)
      types.length = 0
      for await (const event of flashpi.events.list({ documentId: invoice.id })) {
        types.push(event.type)
        expect(event.data).toMatchObject({ id: invoice.id })
      }
    }
    expect(types).toContain('invoice.authorized')
  })

  it('answers 404 for a document that does not exist', async () => {
    await expect(
      flashpi.documents.get('01a00000-0000-7000-8000-000000000000', { maxRetries: 0 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
