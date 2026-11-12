/**
 * The README examples, type-checked by `pnpm typecheck` (never run): if the SDK's types change,
 * the README must change with them.
 */
import { readFile, writeFile } from 'node:fs/promises'

import {
  APIError,
  Flashpi,
  FlashpiError,
  type ThinWebhookEvent,
  UnprocessableEntityError,
  unwrapWebhook,
  WebhookVerificationError,
} from '../../src'

declare const order: { id: string }
declare const id: string
declare const request: Request
declare const env: { FLASHPI_WEBHOOK_SECRET: string }

/** The bits of Express the webhook example uses. */
interface Req {
  body: Uint8Array
  headers: Record<string, string | string[] | undefined>
}
interface Res {
  status(code: number): Res
  end(): void
  json(body: unknown): void
}

export async function gettingStarted(): Promise<void> {
  const flashpi = new Flashpi()

  const invoice = await flashpi.invoices.create({
    issuerId: '<id>',
    establishment: '001',
    emissionPoint: '001',
    customer: {
      idType: 'ruc',
      id: '1760013210001',
      name: 'PRUEBAS SERVICIO DE RENTAS INTERNAS',
      address: 'Av. Amazonas y Villalengua, Quito',
    },
    items: [
      {
        code: 'P-001',
        description: 'Servicio de prueba',
        quantity: '1',
        unitPrice: '1.00',
        taxes: [{ type: 'vat', rate: '15' }],
      },
    ],
    payments: [{ method: 'cash', amount: '1.15' }],
    options: { waitForAuthorization: true },
  })
  console.log(invoice.status, invoice.accessKey)

  const document = await flashpi.documents.get(invoice.id)
  console.log(document.number)
  const { xml, kind } = await flashpi.documents.xml(invoice.id)
  console.log(xml.length, kind)
  const pdf = await flashpi.documents.pdf(invoice.id)
  await writeFile(`${invoice.accessKey}.pdf`, pdf)
  await flashpi.documents.sendEmail(invoice.id)

  for await (const listed of flashpi.documents.list({
    status: 'authorized',
    issueDateFrom: '2026-11-01',
  })) {
    console.log(listed.accessKey)
  }
  const page = await flashpi.documents.list({ limit: 50 })
  console.log(page.data.length)
  if (page.hasNextPage()) await page.nextPage()

  const body = {} as Parameters<Flashpi['invoices']['create']>[0]
  try {
    await flashpi.invoices.create(body)
  } catch (error) {
    if (error instanceof UnprocessableEntityError) {
      console.log(error.code)
      for (const field of error.errors) console.log(field.field, field.message)
    } else if (error instanceof APIError) {
      console.log(error.status, error.code, error.requestId)
    }
    throw error
  }

  await flashpi.invoices.create(body, { idempotencyKey: `pedido-${order.id}` })

  const configured = new Flashpi({
    apiKey: process.env.FLASHPI_API_KEY,
    language: 'es',
    timeout: 60_000,
    maxRetries: 2,
  })
  const { data, response, requestId } = await configured.documents.get(id).withResponse()
  console.log(data.id, response.status, requestId)
}

export async function issuers(flashpi: Flashpi): Promise<void> {
  let onboarding = await flashpi.issuerOnboardings.create({
    file: await readFile('firma.p12'),
    password: process.env.P12_PASSWORD ?? '',
  })
  while (onboarding.status === 'verifying') {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    onboarding = await flashpi.issuerOnboardings.get(onboarding.id)
  }
  if (onboarding.status !== 'ready') {
    throw new Error(onboarding.rejection?.message ?? onboarding.status)
  }

  const { prefill } = onboarding
  const { issuer } = onboarding.existingIssuer
    ? await flashpi.issuerOnboardings.complete(onboarding.id)
    : await flashpi.issuerOnboardings.complete(onboarding.id, {
        legalName: prefill?.legalName ?? 'MI EMPRESA S.A.',
        headOfficeAddress: prefill?.headOfficeAddress ?? 'Av. Amazonas N24-100, Quito',
        taxProfile: {
          keepsAccounting: prefill?.taxProfile.keepsAccounting ?? false,
          rimpeRegime:
            prefill?.taxProfile.rimpeRegime === 'general'
              ? null
              : (prefill?.taxProfile.rimpeRegime ?? null),
        },
      })

  for await (const establishment of flashpi.issuers.establishments.list(issuer.id)) {
    console.log(establishment.code)
  }

  await flashpi.issuers.certificates.upload(issuer.id, {
    file: await readFile('firma-nueva.p12'),
    password: process.env.P12_PASSWORD ?? '',
  })
}

export async function retryLater(
  flashpi: Flashpi,
  body: Parameters<Flashpi['invoices']['create']>[0],
): Promise<void> {
  try {
    await flashpi.invoices.create(body)
  } catch (error) {
    if (error instanceof APIError || error instanceof FlashpiError) {
      await flashpi.invoices.create(body, { idempotencyKey: error.idempotencyKey })
    }
  }
}

export async function expressWebhook(req: Req, res: Res): Promise<void> {
  let event
  try {
    event = await unwrapWebhook(req.body, req.headers, process.env.FLASHPI_WEBHOOK_SECRET ?? '')
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      res.status(400).end()
      return
    }
    throw error
  }

  switch (event.type) {
    case 'webhook_endpoint.verification':
      res.json({ challenge: event.data.challenge })
      return
    case 'invoice.authorized':
      console.log('Autorizada', event.data.accessKey)
      break
    case 'invoice.rejected':
      console.log('Rechazada', event.data.sriMessages)
      break
  }
  res.status(204).end()
}

export async function fetchWebhook(flashpi: Flashpi): Promise<void> {
  const event = await unwrapWebhook(
    await request.text(),
    request.headers,
    env.FLASHPI_WEBHOOK_SECRET,
  )
  console.log(event.id)
  const thin = await unwrapWebhook<ThinWebhookEvent>('', request.headers, '')
  const full = await flashpi.events.get(thin.id)
  console.log(full.type)
}
