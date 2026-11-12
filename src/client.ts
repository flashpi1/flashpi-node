import { FlashpiError } from './core/errors'
import { type Fetch, HttpClient, type Language } from './core/http'
import { Documents, DocumentIssuer } from './resources/documents'
import type {
  CreditNotes,
  DebitNotes,
  Invoices,
  PurchaseSettlements,
  Waybills,
  Withholdings,
} from './resources/documents'
import { Events } from './resources/events'
import { IssuerOnboardings } from './resources/issuer-onboardings'
import { Issuers } from './resources/issuers'
import { Status } from './resources/status'
import { WebhookEndpoints } from './resources/webhook-endpoints'
import type { Environment } from './types'
import { Webhooks } from './webhooks'

/** Settings of a Flashpi client. */
export interface ClientOptions {
  /** The API key (`fp_test_...` or `fp_live_...`). Defaults to the FLASHPI_API_KEY variable. */
  apiKey?: string
  /** Milliseconds to wait for each attempt of a request (default 60 000). */
  timeout?: number
  /** Retries after network errors, timeouts, 429 and 5xx (default 2; 0 turns them off). */
  maxRetries?: number
  /** Language of the API's messages: `en` (default) or `es`. Error codes do not change. */
  language?: Language
  /** The API's address (default https://api.flashpi.com.ec). */
  baseUrl?: string
  /** A `fetch` implementation, for proxies or tests (default: the runtime's `fetch`). */
  fetch?: Fetch
  /** Headers sent with every request. */
  defaultHeaders?: Record<string, string>
}

export const DEFAULT_BASE_URL = 'https://api.flashpi.com.ec'
export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_RETRIES = 2

/**
 * The Flashpi API client.
 *
 * ```ts
 * import { Flashpi } from '@flashpi/node'
 *
 * const flashpi = new Flashpi(process.env.FLASHPI_API_KEY)
 * const invoice = await flashpi.invoices.create({ ... })
 * ```
 *
 * An `fp_test_` key issues in the SRI test environment (pruebas); an `fp_live_` key issues
 * real documents in production. Use it on servers only: the key must stay secret.
 */
export class Flashpi {
  /** `test` for fp_test_ keys (SRI pruebas), `live` for fp_live_ keys (SRI production). */
  readonly environment: Environment

  /** Facturas. */
  readonly invoices: Invoices
  /** Notas de crédito. */
  readonly creditNotes: CreditNotes
  /** Notas de débito. */
  readonly debitNotes: DebitNotes
  /** Liquidaciones de compra. */
  readonly purchaseSettlements: PurchaseSettlements
  /** Guías de remisión. */
  readonly waybills: Waybills
  /** Comprobantes de retención. */
  readonly withholdings: Withholdings
  /** Every issued document: search, XML, RIDE (PDF) and email. */
  readonly documents: Documents
  /** Issuers (RUCs) with their establishments, emission points and certificates. */
  readonly issuers: Issuers
  /** Create an issuer from its .p12 certificate. */
  readonly issuerOnboardings: IssuerOnboardings
  /** The URLs Flashpi sends events to. */
  readonly webhookEndpoints: WebhookEndpoints
  /** Events of documents, certificates and email sending. */
  readonly events: Events
  /** The API's status. */
  readonly status: Status
  /** Verify the signature of webhooks you receive. */
  readonly webhooks: Webhooks

  constructor(apiKey?: string, options?: ClientOptions)
  constructor(options?: ClientOptions)
  constructor(apiKeyOrOptions?: string | ClientOptions, maybeOptions: ClientOptions = {}) {
    assertServerRuntime()
    const options =
      typeof apiKeyOrOptions === 'object'
        ? apiKeyOrOptions
        : { ...maybeOptions, apiKey: apiKeyOrOptions ?? maybeOptions.apiKey }
    const apiKey = (options.apiKey ?? readEnv('FLASHPI_API_KEY'))?.trim()
    this.environment = environmentOf(apiKey)

    // Looked up on every call, so tools that patch the global fetch later (mocks) still work.
    const fetchImplementation: Fetch =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    const http = new HttpClient({
      apiKey: apiKey ?? '',
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      timeout: positive('timeout', options.timeout ?? DEFAULT_TIMEOUT_MS),
      maxRetries: nonNegativeInteger('maxRetries', options.maxRetries ?? DEFAULT_MAX_RETRIES),
      language: options.language,
      fetch: fetchImplementation,
      defaultHeaders: options.defaultHeaders ?? {},
    })

    this.invoices = new DocumentIssuer(http, '/v1/invoices')
    this.creditNotes = new DocumentIssuer(http, '/v1/credit-notes')
    this.debitNotes = new DocumentIssuer(http, '/v1/debit-notes')
    this.purchaseSettlements = new DocumentIssuer(http, '/v1/purchase-settlements')
    this.waybills = new DocumentIssuer(http, '/v1/waybills')
    this.withholdings = new DocumentIssuer(http, '/v1/withholdings')
    this.documents = new Documents(http)
    this.issuers = new Issuers(http)
    this.issuerOnboardings = new IssuerOnboardings(http)
    this.webhookEndpoints = new WebhookEndpoints(http)
    this.events = new Events(http)
    this.status = new Status(http)
    this.webhooks = new Webhooks()
  }
}

function environmentOf(apiKey: string | undefined): Environment {
  if (!apiKey) {
    throw new FlashpiError(
      'Missing API key: pass it to new Flashpi(apiKey) or set the FLASHPI_API_KEY environment variable',
    )
  }
  if (apiKey.startsWith('fp_test_')) return 'test'
  if (apiKey.startsWith('fp_live_')) return 'live'
  if (apiKey.startsWith('whsec_')) {
    throw new FlashpiError(
      'That is a webhook signing secret (whsec_...), not an API key: use it with flashpi.webhooks',
    )
  }
  throw new FlashpiError('The API key must start with fp_test_ or fp_live_')
}

/** API keys are secrets: refuse to run where page visitors could read them. */
function assertServerRuntime(): void {
  const scope = globalThis as { window?: unknown; document?: unknown }
  if (typeof scope.window !== 'undefined' && typeof scope.document !== 'undefined') {
    throw new FlashpiError(
      'The Flashpi SDK runs on servers only: in a browser your API key would be visible to anyone. Call Flashpi from your backend.',
    )
  }
}

/** An environment variable on Node.js, Bun and Deno, or `undefined` (Workers, no permission). */
function readEnv(name: string): string | undefined {
  const scope = globalThis as { process?: { env?: Record<string, string | undefined> } }
  try {
    return scope.process?.env?.[name]
  } catch {
    // Deno without --allow-env throws instead of answering.
    return undefined
  }
}

function positive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new FlashpiError(`${name} must be a positive number of milliseconds`)
  }
  return value
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new FlashpiError(`${name} must be a whole number, 0 or more`)
  }
  return value
}
