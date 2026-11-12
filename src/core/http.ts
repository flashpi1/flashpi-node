import { VERSION } from '../version'
import type { WithResponse } from './api-promise'
import { APIError, ConnectionError, FlashpiError, TimeoutError } from './errors'

/** Languages the API writes its messages in. Error codes are the same in both. */
export type Language = 'en' | 'es'

/** A `fetch` implementation (the runtime's global `fetch` by default). */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>

/** Options every method accepts as its last argument. */
export interface RequestOptions {
  /**
   * Idempotency-Key of a POST (1 to 255 printable ASCII characters, unique per operation). The
   * SDK creates one when it is missing and reuses it on its retries, so a retry never issues a
   * document twice. Ignored by other methods.
   */
  idempotencyKey?: string
  /** Milliseconds to wait for each attempt, overriding the client's `timeout`. */
  timeout?: number
  /** Retries after network errors, timeouts, 429 and 5xx, overriding the client's `maxRetries`. */
  maxRetries?: number
  /** Cancels the request (and its retries). */
  signal?: AbortSignal
  /** Language of the API's messages for this request, overriding the client's `language`. */
  language?: Language
  /** Your own id for the request (`X-Correlation-Id`, 1 to 128 of `A-Za-z0-9._:/+=-`), echoed back and logged by Flashpi. */
  correlationId?: string
  /** Extra headers for this request. */
  headers?: Record<string, string>
}

/** The client settings the HTTP layer needs. */
export interface HttpConfig {
  apiKey: string
  baseUrl: string
  timeout: number
  maxRetries: number
  language: Language | undefined
  fetch: Fetch
  defaultHeaders: Record<string, string>
}

export type QueryValue = string | number | boolean | null | undefined

type ResponseType = 'json' | 'text' | 'bytes' | 'none'

/** One API operation, as the resources describe it. */
export interface RequestSpec<T> {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  query?: object | undefined
  /** A JSON body. */
  body?: unknown
  /** A multipart body, built again for every attempt. */
  multipart?: () => FormData
  /** The Accept header (application/json by default). */
  accept?: string
  /** How to read a successful answer (JSON by default). */
  responseType?: ResponseType
  options?: RequestOptions | undefined
  /** A floor for the per-attempt timeout, for requests the API holds open (sync issuing). */
  minTimeout?: number
  /**
   * For document POSTs: when a retry of this call is answered 422 `idempotency_key_reused`
   * with a `documentId`, an earlier attempt created the document, so this fetches it instead
   * of failing.
   */
  recoverDocument?: (documentId: string, options: RequestOptions) => Promise<WithResponse<T>>
}

/** Longest `Retry-After` the SDK waits for by itself; longer waits (daily quotas) are thrown. */
export const MAX_RETRY_AFTER_MS = 60_000

const INITIAL_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 8_000

/** Sends requests to the Flashpi API with retries, timeouts and typed errors. */
export class HttpClient {
  readonly #config: HttpConfig

  constructor(config: HttpConfig) {
    this.#config = config
  }

  async request<T>(spec: RequestSpec<T>): Promise<WithResponse<T>> {
    const options = spec.options ?? {}
    const maxRetries = options.maxRetries ?? this.#config.maxRetries
    const timeout = Math.max(options.timeout ?? this.#config.timeout, spec.minTimeout ?? 0)
    const url = this.#url(spec.path, spec.query)
    const idempotencyKey =
      spec.method === 'POST' ? (options.idempotencyKey ?? crypto.randomUUID()) : undefined

    for (let attempt = 0; ; attempt++) {
      const init: RequestInit = {
        method: spec.method,
        headers: this.#headers(spec, options, idempotencyKey),
      }
      if (spec.multipart) init.body = spec.multipart()
      else if (spec.body !== undefined) init.body = JSON.stringify(spec.body)

      let failure: FlashpiError
      try {
        const result = await this.#send<T>(url, init, timeout, options.signal, spec.responseType)
        if (!(result instanceof APIError)) return result
        failure = result
      } catch (error) {
        if (!(error instanceof ConnectionError)) throw error
        failure = error
      }

      if (attempt > 0 && failure instanceof APIError) {
        const recovered = await this.#recover(spec, failure, options)
        if (recovered) return recovered
      }

      const delay = retryDelay(failure, attempt)
      if (delay === null || attempt >= maxRetries) throw failure
      await sleep(delay, options.signal)
    }
  }

  /** An answer that shows an earlier attempt of this call already did the work. */
  async #recover<T>(
    spec: RequestSpec<T>,
    failure: APIError,
    options: RequestOptions,
  ): Promise<WithResponse<T> | null> {
    if (
      spec.recoverDocument &&
      failure.status === 422 &&
      failure.code === 'idempotency_key_reused'
    ) {
      const documentId = failure.problem?.documentId
      if (typeof documentId === 'string' && documentId !== '') {
        const { idempotencyKey: _unused, ...readOptions } = options
        return spec.recoverDocument(documentId, readOptions)
      }
    }
    // A DELETE retried after a lost answer finds the resource already gone.
    if (spec.method === 'DELETE' && failure.status === 404) {
      return {
        data: undefined as T,
        response: new Response(null, { status: 204, headers: failure.headers }),
        requestId: failure.requestId,
      }
    }
    return null
  }

  /** One attempt: the answer's data, or the APIError of an error status. */
  async #send<T>(
    url: string,
    init: RequestInit,
    timeout: number,
    userSignal: AbortSignal | undefined,
    responseType: ResponseType = 'json',
  ): Promise<WithResponse<T> | APIError> {
    userSignal?.throwIfAborted()
    const controller = new AbortController()
    const timedOut = new TimeoutError(
      `${init.method ?? 'GET'} ${url} timed out after ${timeout} ms`,
    )
    const timer = setTimeout(() => {
      controller.abort(timedOut)
    }, timeout)
    const onAbort = (): void => {
      controller.abort(userSignal?.reason)
    }
    userSignal?.addEventListener('abort', onAbort, { once: true })

    try {
      let response: Response
      let text: string | undefined
      let bytes: Uint8Array | undefined
      try {
        response = await this.#config.fetch(url, { ...init, signal: controller.signal })
        if (!response.ok || responseType !== 'bytes') text = await response.text()
        else bytes = new Uint8Array(await response.arrayBuffer())
      } catch (error) {
        if (userSignal?.aborted) throw userSignal.reason
        if (controller.signal.reason === timedOut) throw timedOut
        throw new ConnectionError(`${init.method ?? 'GET'} ${url} failed: ${describe(error)}`, {
          cause: error,
        })
      }

      const requestId = response.headers.get('x-request-id')
      if (!response.ok) return APIError.from(response.status, response.headers, text ?? '')
      const data = readData(responseType, response.status, text, bytes) as T
      return { data, response, requestId }
    } finally {
      clearTimeout(timer)
      userSignal?.removeEventListener('abort', onAbort)
    }
  }

  #url(path: string, query: object | undefined): string {
    const base = this.#config.baseUrl.replace(/\/+$/, '')
    const search = new URLSearchParams()
    for (const [name, value] of Object.entries(query ?? {}) as [string, QueryValue][]) {
      if (value === undefined || value === null) continue
      search.append(name, String(value))
    }
    const queryString = search.toString()
    return `${base}${path}${queryString ? `?${queryString}` : ''}`
  }

  #headers<T>(
    spec: RequestSpec<T>,
    options: RequestOptions,
    idempotencyKey: string | undefined,
  ): Headers {
    const headers = new Headers({
      accept: spec.accept ?? 'application/json',
      'user-agent': `flashpi-node/${VERSION}`,
    })
    const language = options.language ?? this.#config.language
    if (language) headers.set('accept-language', language)
    for (const [name, value] of Object.entries(this.#config.defaultHeaders))
      headers.set(name, value)
    for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value)
    if (options.correlationId !== undefined) headers.set('x-correlation-id', options.correlationId)
    if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
    if (!spec.multipart && spec.body !== undefined) headers.set('content-type', 'application/json')
    // FormData sets its own multipart content type with the boundary.
    if (spec.multipart) headers.delete('content-type')
    headers.set('authorization', `Bearer ${this.#config.apiKey}`)
    return headers
  }
}

function readData(
  responseType: ResponseType,
  status: number,
  text: string | undefined,
  bytes: Uint8Array | undefined,
): unknown {
  if (responseType === 'bytes') return bytes
  if (responseType === 'text') return text
  if (responseType === 'none' || status === 204 || !text) return undefined
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new FlashpiError(`The API answered ${status} with a body that is not JSON`, {
      cause: error,
    })
  }
}

/**
 * Milliseconds to wait before retrying, or `null` when the failure must not be retried.
 *
 * Retried: network errors and timeouts, 408, 429 and 5xx (with `Retry-After` up to
 * {@link MAX_RETRY_AFTER_MS}), and 409 `idempotency_key_in_progress` (the first attempt is
 * still running). POSTs are safe to retry because they keep their Idempotency-Key.
 */
export function retryDelay(failure: FlashpiError, attempt: number): number | null {
  if (failure instanceof ConnectionError) return backoff(attempt)
  if (!(failure instanceof APIError)) return null
  const { status, code } = failure
  if (status === 409) {
    return code === 'idempotency_key_in_progress' ? Math.max(1_000, backoff(attempt)) : null
  }
  const transient = status === 408 || status === 429 || (status >= 500 && status !== 501)
  // The shared demo certificate is missing: no retry within seconds will fix that.
  if (!transient || code === 'demo_issuer_unavailable') return null
  const retryAfter = failure.retryAfter
  if (retryAfter === null) return backoff(attempt)
  const milliseconds = retryAfter * 1_000
  return milliseconds <= MAX_RETRY_AFTER_MS ? milliseconds : null
}

/** Exponential backoff from 0.5 s up to 8 s, minus up to 25 % of jitter. */
function backoff(attempt: number): number {
  const delay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS)
  return Math.round(delay * (1 - Math.random() * 0.25))
}

function sleep(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error)
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason as Error)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : ''
    return `${error.message}${cause}`
  }
  return String(error)
}

/** Encodes path parameters: `pathOf\`/v1/issuers/${issuerId}\``. Rejects empty ids. */
export function pathOf(strings: TemplateStringsArray, ...ids: string[]): string {
  let result = strings[0] ?? ''
  ids.forEach((id, index) => {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new FlashpiError(`Missing id in ${strings.join('{id}')}: got ${JSON.stringify(id)}`)
    }
    result += encodeURIComponent(id) + (strings[index + 1] ?? '')
  })
  return result
}
