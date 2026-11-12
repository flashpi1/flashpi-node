# Flashpi para Node.js

SDK oficial de [Flashpi](https://flashpi.com.ec), la API de facturación electrónica del SRI de
Ecuador, para Node.js y TypeScript.

> **Aún no está publicado en npm.** La primera versión (0.1.0) está en preparación. Mientras
> tanto puedes usar la API con HTTP simple: consulta la [documentación](https://flashpi.com.ec/docs/).

[English](README.en.md)

- Las 45 operaciones de la API: los seis comprobantes, documentos (XML, RIDE en PDF, correo),
  emisores con establecimientos, puntos de emisión y certificados .p12, webhooks y eventos.
- Tipos de TypeScript generados del documento OpenAPI de la API.
- Reintentos seguros: cada emisión lleva un `Idempotency-Key`, así un reintento nunca emite dos
  veces.
- Errores tipados (RFC 9457) con su `code`, los errores por campo y el `requestId`.
- Paginación automática con `for await`.
- Verificación de firmas de webhooks (Standard Webhooks).
- Sin dependencias. Funciona en Node.js 22 o superior, Bun, Deno y Cloudflare Workers, con
  `import` o `require`.

## Instalación

```bash
npm install @flashpi/node
```

También con `pnpm add @flashpi/node`, `yarn add @flashpi/node` o `bun add @flashpi/node`.

## Primeros pasos

Crea una clave de API en la [consola](https://flashpi.com.ec/app/) y guárdala en la variable de
entorno `FLASHPI_API_KEY`. Una clave `fp_test_` emite en el ambiente de pruebas del SRI; una
`fp_live_` emite comprobantes reales en producción.

```ts
import { Flashpi } from '@flashpi/node'

// Lee FLASHPI_API_KEY; también puedes pasarla: new Flashpi('fp_test_...')
const flashpi = new Flashpi()

const invoice = await flashpi.invoices.create({
  issuerId: '<id del emisor demo o del tuyo>',
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
```

Los montos y cantidades son **textos** (`'1.15'`), nunca números, para no perder decimales.

Con el **emisor demo** puedes emitir en pruebas sin subir un certificado: su id está en el
Resumen de la consola (hasta 50 comprobantes al día). Más en
[Sandbox y emisor demo](https://flashpi.com.ec/docs/sandbox/).

## Emitir comprobantes

| Comprobante           | Método                                     |
| --------------------- | ------------------------------------------ |
| Factura               | `flashpi.invoices.create(body)`            |
| Nota de crédito       | `flashpi.creditNotes.create(body)`         |
| Nota de débito        | `flashpi.debitNotes.create(body)`          |
| Liquidación de compra | `flashpi.purchaseSettlements.create(body)` |
| Guía de remisión      | `flashpi.waybills.create(body)`            |
| Retención             | `flashpi.withholdings.create(body)`        |

Todos devuelven el documento. Por defecto la respuesta llega enseguida con el estado
`processing` y el resultado del SRI llega por webhook. Con
`options: { waitForAuthorization: true }` la API espera la respuesta del SRI (15 s por defecto,
hasta 30 s con `waitTimeoutSeconds`) y devuelve `authorized`, `rejected` o `failed`; si el SRI
tarda más, devuelve `processing` o `pending_sri` y el documento sigue su curso.

## Documentos

```ts
const document = await flashpi.documents.get(invoice.id)

const { xml, kind } = await flashpi.documents.xml(invoice.id) // kind: 'authorized' cuando ya lo autorizó el SRI
const pdf = await flashpi.documents.pdf(invoice.id) // el RIDE, como Uint8Array
await writeFile(`${invoice.accessKey}.pdf`, pdf)

await flashpi.documents.sendEmail(invoice.id) // reenvía RIDE y XML al correo del comprador
```

## Listas y paginación

Una lista devuelve una página. Con `for await` recorres todas las páginas, que se piden a medida
que avanzas:

```ts
for await (const document of flashpi.documents.list({
  status: 'authorized',
  issueDateFrom: '2026-11-01',
})) {
  console.log(document.accessKey)
}

const page = await flashpi.documents.list({ limit: 50 })
page.data // los documentos de esta página
if (page.hasNextPage()) await page.nextPage()
```

## Errores

Cada error de la API es una subclase de `APIError` según su estado HTTP. Decide según `code`,
que es estable y en inglés; `message` sigue el idioma pedido.

```ts
import { APIError, ConflictError, UnprocessableEntityError } from '@flashpi/node'

try {
  await flashpi.invoices.create(body)
} catch (error) {
  if (error instanceof UnprocessableEntityError) {
    console.log(error.code) // 'validation_failed', 'total_mismatch', ...
    for (const field of error.errors) console.log(field.field, field.message)
  } else if (error instanceof APIError) {
    console.log(error.status, error.code, error.requestId) // comparte requestId con soporte
  }
  throw error
}
```

| Clase                      | Estado | Ejemplos de `code`                                          |
| -------------------------- | ------ | ----------------------------------------------------------- |
| `BadRequestError`          | 400    | `malformed_json`, `invalid_idempotency_key`                 |
| `AuthenticationError`      | 401    | `authentication_required`, `invalid_api_key`                |
| `PermissionDeniedError`    | 403    | `key_read_only`, `key_scope_mismatch`, `ip_not_allowed`     |
| `NotFoundError`            | 404    | `not_found`                                                 |
| `ConflictError`            | 409    | `sequential_already_used`, `ride_not_available`             |
| `UnprocessableEntityError` | 422    | `validation_failed`, `total_mismatch`                       |
| `RateLimitError`           | 429    | `demo_issuer_quota_exceeded`, `account_email_limit_reached` |
| `InternalServerError`      | 5xx    | `internal_error`                                            |
| `ConnectionError`          | —      | sin respuesta (red); `TimeoutError` si se agotó el tiempo   |

Algunos errores traen datos extra en `error.problem`, por ejemplo `documentId`, `limit`,
`resetsAt` o `rideStatus`. Para recibir los mensajes en español:
`new Flashpi({ language: 'es' })`.

## Reintentos e idempotencia

El SDK reintenta hasta 2 veces, con espera creciente, los errores de red, los tiempos agotados,
las respuestas 408, 429 (si piden esperar 60 s o menos) y 5xx. Cada POST lleva un
`Idempotency-Key` que se repite en sus reintentos, así que la API nunca emite dos veces. Si un
reintento descubre que el primer intento sí creó el documento, el SDK devuelve ese documento.

Para usar tu propia clave (por ejemplo el id de tu pedido), pásala en las opciones:

```ts
await flashpi.invoices.create(body, { idempotencyKey: `pedido-${order.id}` })
```

Los límites diarios (como la cuota del emisor demo) no se reintentan: se lanzan como
`RateLimitError` con `retryAfter` en segundos.

## Webhooks

Verifica cada webhook con el cuerpo **tal cual llegó** (sin parsear) y el secreto `whsec_` del
endpoint. `unwrapWebhook` no necesita clave de API.

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
      // La activación del endpoint: responde el desafío.
      return res.json({ challenge: event.data.challenge })
    case 'invoice.authorized':
      console.log('Autorizada', event.data.accessKey) // event.data es el documento
      break
    case 'invoice.rejected':
      console.log('Rechazada', event.data.sriMessages)
      break
  }
  res.status(204).end()
})
```

En Next.js, Hono, Cloudflare Workers o cualquier entorno con `Request`:

```ts
const event = await unwrapWebhook(await request.text(), request.headers, env.FLASHPI_WEBHOOK_SECRET)
```

Guarda el `event.id` y descarta los repetidos: un evento puede llegar más de una vez. Durante
una rotación del secreto, Flashpi firma con el nuevo y el anterior, así que cualquiera de los dos
sirve. Si el endpoint usa el modo `thin` (sin `data`), usa `unwrapWebhook<ThinWebhookEvent>(...)`
y pide el evento con `flashpi.events.get(event.id)`.

## Emisores y certificados

Estas operaciones necesitan una clave de toda la cuenta con acceso de lectura y escritura.

```ts
import { readFile } from 'node:fs/promises'

// Crear un emisor a partir de su firma electrónica (.p12)
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
// Revisa onboarding.prefill (datos del SRI). Si rucNeedsConfirmation es true, envía { ruc }.
const { issuer } = await flashpi.issuerOnboardings.complete(onboarding.id)

// Renovar el certificado de un emisor
await flashpi.issuers.certificates.upload(issuer.id, {
  file: await readFile('firma-nueva.p12'),
  password: process.env.P12_PASSWORD!,
})

for await (const establishment of flashpi.issuers.establishments.list(issuer.id)) {
  console.log(establishment.code)
}
```

## Opciones

```ts
const flashpi = new Flashpi({
  apiKey: process.env.FLASHPI_API_KEY, // por defecto, la variable FLASHPI_API_KEY
  language: 'es', // idioma de los mensajes: 'en' (por defecto) o 'es'
  timeout: 60_000, // milisegundos por intento (se amplía solo en el modo síncrono)
  maxRetries: 2, // 0 desactiva los reintentos
})
```

Cada método acepta al final opciones de esa petición: `idempotencyKey`, `timeout`, `maxRetries`,
`signal` (un `AbortSignal` para cancelar), `language`, `correlationId` (tu propio id, que
Flashpi registra) y `headers`.

Para ver la respuesta HTTP y el id de la petición:

```ts
const { data, response, requestId } = await flashpi.documents.get(id).withResponse()
```

## Solo en el servidor

Tu clave de API es secreta. El SDK se niega a correr en un navegador; llama a Flashpi desde tu
backend.

## Licencia

[MIT](LICENSE) © 2026 SIGNIADIGITAL S.A.
