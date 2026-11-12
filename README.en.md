# Flashpi for Node.js

The official Node.js and TypeScript SDK for [Flashpi](https://flashpi.com.ec), the electronic
invoicing API for Ecuador's SRI.

> **Not published on npm yet.** The first version (0.1.0) is being prepared. Meanwhile, call the
> API over plain HTTP: see the [documentation](https://flashpi.com.ec/docs/en/).

[Español](README.md)

- The 45 operations of the API: the six document types, documents (XML, RIDE PDF, email),
  issuers with establishments, emission points and .p12 certificates, webhooks and events.
- TypeScript types generated from the API's OpenAPI document.
- Safe retries: every issuing request carries an `Idempotency-Key`, so a retry never issues a
  document twice.
- Typed errors (RFC 9457) with their `code`, field errors and `requestId`.
- Automatic pagination with `for await`.
- Webhook signature verification (Standard Webhooks).
- No dependencies. Runs on Node.js 22 or later, Bun, Deno and Cloudflare Workers, with `import`
  or `require`.

## Install

```bash
npm install @flashpi/node
```

Or `pnpm add @flashpi/node`, `yarn add @flashpi/node`, `bun add @flashpi/node`.

## Getting started

Create an API key in the [console](https://flashpi.com.ec/app/) and keep it in the
`FLASHPI_API_KEY` environment variable. An `fp_test_` key issues in the SRI's test environment;
an `fp_live_` key issues real documents in production.

```ts
import { Flashpi } from '@flashpi/node'

// Reads FLASHPI_API_KEY; you can also pass it: new Flashpi('fp_test_...')
const flashpi = new Flashpi()

const invoice = await flashpi.invoices.create({
  issuerId: '<the demo issuer id or yours>',
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
      description: 'Test service',
      quantity: '1',
      unitPrice: '1.00',
      taxes: [{ type: 'vat', rate: '15' }],
    },
  ],
  payments: [{ method: 'cash', amount: '1.15' }],
  options: { waitForAuthorization: true },
})

console.log(invoice.status, invoice.accessKey)
```

Amounts and quantities are **strings** (`'1.15'`), never numbers, so no decimals are lost.

With the **demo issuer** you can issue test documents without uploading a certificate: its id is
on the console's Overview (up to 50 documents a day). See
[Sandbox and demo issuer](https://flashpi.com.ec/docs/en/sandbox/).

## Issuing documents

| Document                                    | Method                                     |
| ------------------------------------------- | ------------------------------------------ |
| Invoice (factura)                           | `flashpi.invoices.create(body)`            |
| Credit note (nota de crédito)               | `flashpi.creditNotes.create(body)`         |
| Debit note (nota de débito)                 | `flashpi.debitNotes.create(body)`          |
| Purchase settlement (liquidación de compra) | `flashpi.purchaseSettlements.create(body)` |
| Waybill (guía de remisión)                  | `flashpi.waybills.create(body)`            |
| Withholding (comprobante de retención)      | `flashpi.withholdings.create(body)`        |

They all return the document. By default the answer comes right away with the status
`processing`, and the SRI's outcome arrives by webhook. With
`options: { waitForAuthorization: true }` the API waits for the SRI (15 s by default, up to 30 s
with `waitTimeoutSeconds`) and returns `authorized`, `rejected` or `failed`; if the SRI takes
longer, it returns `processing` or `pending_sri` and the document carries on.

## Documents

```ts
const document = await flashpi.documents.get(invoice.id)

const { xml, kind } = await flashpi.documents.xml(invoice.id) // kind: 'authorized' once the SRI authorized it
const pdf = await flashpi.documents.pdf(invoice.id) // the RIDE, as a Uint8Array
await writeFile(`${invoice.accessKey}.pdf`, pdf)

await flashpi.documents.sendEmail(invoice.id) // emails the RIDE and XML to the buyer again
```

## Lists and pagination

A list call returns a page. `for await` walks every page, fetching them as you go:

```ts
for await (const document of flashpi.documents.list({
  status: 'authorized',
  issueDateFrom: '2026-11-01',
})) {
  console.log(document.accessKey)
}

const page = await flashpi.documents.list({ limit: 50 })
page.data // the documents of this page
if (page.hasNextPage()) await page.nextPage()
```

## Errors

Every API error is an `APIError` subclass chosen by its HTTP status. Branch on `code`, which is
stable and in English; `message` follows the requested language.

```ts
import { APIError, UnprocessableEntityError } from '@flashpi/node'

try {
  await flashpi.invoices.create(body)
} catch (error) {
  if (error instanceof UnprocessableEntityError) {
    console.log(error.code) // 'validation_failed', 'total_mismatch', ...
    for (const field of error.errors) console.log(field.field, field.message)
  } else if (error instanceof APIError) {
    console.log(error.status, error.code, error.requestId) // share requestId with support
  }
  throw error
}
```

| Class                      | Status | Example `code`s                                             |
| -------------------------- | ------ | ----------------------------------------------------------- |
| `BadRequestError`          | 400    | `malformed_json`, `invalid_idempotency_key`                 |
| `AuthenticationError`      | 401    | `authentication_required`, `invalid_api_key`                |
| `PermissionDeniedError`    | 403    | `key_read_only`, `key_scope_mismatch`, `ip_not_allowed`     |
| `NotFoundError`            | 404    | `not_found`                                                 |
| `ConflictError`            | 409    | `sequential_already_used`, `ride_not_available`             |
| `UnprocessableEntityError` | 422    | `validation_failed`, `total_mismatch`                       |
| `RateLimitError`           | 429    | `demo_issuer_quota_exceeded`, `account_email_limit_reached` |
| `InternalServerError`      | 5xx    | `internal_error`                                            |
| `ConnectionError`          | —      | no answer (network); `TimeoutError` when it timed out       |

Some errors carry extra members in `error.problem`, such as `documentId`, `limit`, `resetsAt` or
`rideStatus`. For Spanish messages: `new Flashpi({ language: 'es' })`.

## Retries and idempotency

The SDK retries network errors, timeouts, and 408, 429 (when asked to wait 60 s or less) and
5xx answers up to 2 times, with growing waits. Every POST carries an `Idempotency-Key` that its
retries repeat, so the API never issues twice:

- When a retry finds that the first attempt did create the document, the SDK returns that
  document.
- When the first attempt is still running on the API (for example, the connection dropped while
  it waited for the SRI), the SDK waits for it with the same key, up to the call's time limit,
  without using up retries.

To use your own key (for example your order id), pass it in the options:

```ts
await flashpi.invoices.create(body, { idempotencyKey: `order-${order.id}` })
```

If issuing still fails, the error carries the key it used: trying again later with
`{ idempotencyKey: error.idempotencyKey }` returns the same document instead of issuing another.

Daily limits (such as the demo issuer's quota) are not retried: they are thrown as a
`RateLimitError` with `retryAfter` in seconds.

## Webhooks

Verify every webhook with the body **exactly as received** (not parsed) and the endpoint's
`whsec_` secret. `unwrapWebhook` needs no API key.

```ts
import express from 'express'
import { unwrapWebhook, WebhookVerificationError } from '@flashpi/node'

const app = express()

app.post('/webhooks/flashpi', express.raw({ type: 'application/json' }), async (req, res) => {
  let event
  try {
    event = await unwrapWebhook(req.body, req.headers, process.env.FLASHPI_WEBHOOK_SECRET!)
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.status(400).end()
    throw error
  }

  switch (event.type) {
    case 'webhook_endpoint.verification':
      // The endpoint's activation: answer the challenge.
      return res.json({ challenge: event.data.challenge })
    case 'invoice.authorized':
      console.log('Authorized', event.data.accessKey) // event.data is the document
      break
    case 'invoice.rejected':
      console.log('Rejected', event.data.sriMessages)
      break
  }
  res.status(204).end()
})
```

On Next.js, Hono, Cloudflare Workers or anywhere with a `Request`:

```ts
const event = await unwrapWebhook(await request.text(), request.headers, env.FLASHPI_WEBHOOK_SECRET)
```

Store `event.id` and skip repeats: an event can arrive more than once. During a secret rotation
Flashpi signs with both the new and the previous secret, so either works. If the endpoint uses
`thin` mode (no `data`), use `unwrapWebhook<ThinWebhookEvent>(...)` and fetch the event with
`flashpi.events.get(event.id)`.

## Issuers and certificates

These operations need an account-wide key with read and write access.

An issuer starts from its electronic signature (.p12): Flashpi checks it, reads the RUC and asks
the SRI, and returns a `prefill` with what it found so you can build the issuer.

```ts
import { readFile } from 'node:fs/promises'

let onboarding = await flashpi.issuerOnboardings.create({
  file: await readFile('firma.p12'),
  password: process.env.P12_PASSWORD!,
})
while (onboarding.status === 'verifying') {
  await new Promise((resolve) => setTimeout(resolve, 2000))
  onboarding = await flashpi.issuerOnboardings.get(onboarding.id)
}
if (onboarding.status !== 'ready')
  throw new Error(onboarding.rejection?.message ?? onboarding.status)

const { prefill } = onboarding
const { issuer } = onboarding.existingIssuer
  ? // You already have that RUC: the certificate is added to that issuer (a renewal).
    await flashpi.issuerOnboardings.complete(onboarding.id)
  : // A new RUC: you confirm the issuer's data, starting from the prefill.
    await flashpi.issuerOnboardings.complete(onboarding.id, {
      legalName: prefill?.legalName ?? 'MY COMPANY S.A.',
      headOfficeAddress: prefill?.headOfficeAddress ?? 'Av. Amazonas N24-100, Quito',
      taxProfile: {
        keepsAccounting: prefill?.taxProfile.keepsAccounting ?? false,
        rimpeRegime:
          prefill?.taxProfile.rimpeRegime === 'general'
            ? null
            : (prefill?.taxProfile.rimpeRegime ?? null),
        // For a special taxpayer or a withholding agent, add their resolution numbers.
      },
      // When onboarding.rucNeedsConfirmation is true, send { ruc } too.
    })

for await (const establishment of flashpi.issuers.establishments.list(issuer.id)) {
  console.log(establishment.code)
}
```

To **renew an issuer's signature** for test and live mode at once, run the same flow with the
new .p12: Flashpi recognizes the RUC (`existingIssuer`) and `complete()` with no data adds the
certificate. `flashpi.issuers.certificates.upload(issuerId, { file, password })`, instead,
uploads a certificate for the mode of the key you use only (test or live).

## Options

```ts
const flashpi = new Flashpi({
  apiKey: process.env.FLASHPI_API_KEY, // defaults to the FLASHPI_API_KEY variable
  language: 'es', // language of the messages: 'en' (default) or 'es'
  timeout: 60_000, // milliseconds per attempt (raised by itself in sync mode)
  maxRetries: 2, // 0 turns retries off
})
```

Every method takes the options of that request last: `idempotencyKey`, `timeout`,
`maxRetries`, `signal` (an `AbortSignal` to cancel), `language`, `correlationId` (your own id,
which Flashpi logs) and `headers`.

To see the HTTP response and the request id:

```ts
const { data, response, requestId } = await flashpi.documents.get(id).withResponse()
```

## Servers only

Your API key is a secret. The SDK refuses to run in a browser; call Flashpi from your backend.
Tests with a simulated DOM (jsdom or happy-dom) on Node.js work.

On Deno, the SDK reads `FLASHPI_API_KEY` only with permission: `deno run --allow-env=FLASHPI_API_KEY`.

## License

[MIT](LICENSE) © 2026 SIGNIADIGITAL S.A.
