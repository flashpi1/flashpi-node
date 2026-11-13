import { FlashpiError } from './core/errors'
import { type Fetch, HttpClient, type Language } from './core/http'
import { checkHeaders, headerValue, validRetries, validTimeout } from './core/validate'
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
  /**
   * The API key (`fp_test_...` or `fp_live_...`). Defaults to the FLASHPI_API_KEY variable.
   * Spaces and line breaks around it are trimmed; a key that still has a character other than
   * visible ASCII (a space, a line break, ...) is refused with a `FlashpiError` that never
   * shows it.
   */
  apiKey?: string | undefined
  /** Milliseconds to wait for each attempt of a request (default 60 000). */
  timeout?: number | undefined
  /** Retries after network errors, timeouts, 429 and 5xx (default 2; 0 turns them off). */
  maxRetries?: number | undefined
  /** Language of the API's messages: `en` (default) or `es`. Error codes do not change. */
  language?: Language | undefined
  /** The API's address (default https://api.flashpi.com.ec). */
  baseUrl?: string | undefined
  /** A `fetch` implementation, for proxies or tests (default: the runtime's `fetch`). */
  fetch?: Fetch | undefined
  /**
   * Headers sent with every request (not `Idempotency-Key`: that one is per request). Not
   * Content-Length or Transfer-Encoding either, which fetch sets from the body. A value with a
   * line break or another control character (other than a tab) throws a TypeError when the
   * client is created.
   */
  defaultHeaders?: Record<string, string> | undefined
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
    const fromEnv = options.apiKey === undefined ? readEnv('FLASHPI_API_KEY') : undefined
    const apiKey = (options.apiKey ?? fromEnv?.value)?.trim()
    this.environment = environmentOf(apiKey, fromEnv?.denied)
    const defaultHeaders = options.defaultHeaders ?? {}
    // Checked here, so a bad value fails when the client is created (and again before each
    // request, in case the object changes later).
    const checkedDefaultHeaders = checkHeaders('defaultHeaders', defaultHeaders)
    const language =
      options.language === undefined
        ? undefined
        : (headerValue('language', options.language) as Language)
    if (new Headers(checkedDefaultHeaders).has('idempotency-key')) {
      throw new FlashpiError(
        'defaultHeaders cannot carry an Idempotency-Key: it must be unique per operation. Pass { idempotencyKey } to each create() instead',
      )
    }

    // Looked up on every call, so tools that patch the global fetch later (mocks) still work.
    const fetchImplementation: Fetch =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    const http = new HttpClient({
      apiKey: apiKey ?? '',
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      timeout: validTimeout('timeout', options.timeout ?? DEFAULT_TIMEOUT_MS),
      maxRetries: validRetries('maxRetries', options.maxRetries ?? DEFAULT_MAX_RETRIES),
      language,
      fetch: fetchImplementation,
      defaultHeaders,
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

function environmentOf(apiKey: string | undefined, envDenied: unknown): Environment {
  if (!apiKey) {
    if (envDenied !== undefined) {
      throw new FlashpiError(
        'FLASHPI_API_KEY could not be read: this runtime denied access to environment variables (on Deno, run with --allow-env=FLASHPI_API_KEY). Or pass the key to new Flashpi(apiKey)',
        { cause: envDenied },
      )
    }
    throw new FlashpiError(
      'Missing API key: pass it to new Flashpi(apiKey) or set the FLASHPI_API_KEY environment variable',
    )
  }
  const environment = apiKey.startsWith('fp_test_')
    ? 'test'
    : apiKey.startsWith('fp_live_')
      ? 'live'
      : undefined
  if (environment === undefined) {
    if (apiKey.startsWith('whsec_')) {
      throw new FlashpiError(
        'That is a webhook signing secret (whsec_...), not an API key: use it with flashpi.webhooks',
      )
    }
    throw new FlashpiError('The API key must start with fp_test_ or fp_live_')
  }
  if (!API_KEY_CHARACTERS.test(apiKey)) {
    // Never the key: Headers would refuse it in the Authorization header and quote it whole.
    throw new FlashpiError(
      'The API key has spaces, line breaks or other characters an API key cannot have: copy it again from the Flashpi console',
    )
  }
  return environment
}

/** What an API key is made of: visible ASCII characters, without spaces. */
const API_KEY_CHARACTERS = /^[\x21-\x7e]+$/

/**
 * API keys are secrets: refuse to run in a browser, where page visitors could read them. A
 * simulated DOM (jsdom or happy-dom in tests) on Node.js, Bun or Deno is still a server.
 */
function assertServerRuntime(): void {
  // Read from values a page element cannot fake (`<div id="Deno">` shows up as window.Deno).
  const scope = globalThis as {
    window?: unknown
    document?: unknown
    process?: { versions?: { node?: unknown; bun?: unknown } }
    Deno?: { version?: { deno?: unknown } }
  }
  const serverRuntime =
    typeof scope.process?.versions?.node === 'string' ||
    typeof scope.process?.versions?.bun === 'string' ||
    typeof scope.Deno?.version?.deno === 'string'
  if (
    !serverRuntime &&
    typeof scope.window !== 'undefined' &&
    typeof scope.document !== 'undefined'
  ) {
    throw new FlashpiError(
      'The Flashpi SDK runs on servers only: in a browser your API key would be visible to anyone. Call Flashpi from your backend.',
    )
  }
}

/**
 * An environment variable on Node.js, Bun and Deno. `denied` holds the error of a runtime that
 * refuses to read it (Deno without --allow-env); Workers have no variables here.
 */
function readEnv(name: string): { value?: string | undefined; denied?: unknown } {
  const scope = globalThis as { process?: { env?: Record<string, string | undefined> } }
  try {
    return { value: scope.process?.env?.[name] }
  } catch (error) {
    return { denied: error }
  }
}
