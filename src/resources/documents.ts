import { APIPromise } from '../core/api-promise'
import { type HttpClient, pathOf, type RequestOptions } from '../core/http'
import type { PagePromise } from '../core/pagination'
import { APIResource } from '../core/resource'
import type {
  CreateCreditNote,
  CreateDebitNote,
  CreateInvoice,
  CreatePurchaseSettlement,
  CreateWaybill,
  CreateWithholding,
  Document,
  DocumentListParams,
  DocumentOptions,
  DocumentXml,
} from '../types'

/** Seconds the API waits for the SRI in sync mode when `waitTimeoutSeconds` is not sent. */
const DEFAULT_WAIT_SECONDS = 15
/** Time on top of the sync wait for Flashpi to build, sign and answer. */
const SYNC_MARGIN_MS = 15_000

/**
 * Issues one document type. The answer is the document: `processing` right away (202), or,
 * with `options.waitForAuthorization`, its outcome once the SRI decides (200), unless the wait
 * ends first (202 with `processing` or `pending_sri`; follow it with webhooks or `documents.get`).
 */
export class DocumentIssuer<Body extends { options?: DocumentOptions }> extends APIResource {
  readonly #path: string

  constructor(http: HttpClient, path: string) {
    super(http)
    this.#path = path
  }

  /**
   * Issues the document. Retries reuse the same Idempotency-Key, and when a retry finds the
   * document already created, its current state is returned instead of an error.
   */
  create(body: Body, options?: RequestOptions): APIPromise<Document> {
    const sync = body.options?.waitForAuthorization === true
    const waitSeconds = body.options?.waitTimeoutSeconds ?? DEFAULT_WAIT_SECONDS
    return this._call<Document>({
      method: 'POST',
      path: this.#path,
      body,
      options,
      minTimeout: sync ? waitSeconds * 1_000 + SYNC_MARGIN_MS : 0,
      recoverDocument: (documentId, readOptions) =>
        this.http.request<Document>({
          method: 'GET',
          path: pathOf`/v1/documents/${documentId}`,
          options: readOptions,
        }),
    })
  }
}

/** Facturas. */
export type Invoices = DocumentIssuer<CreateInvoice>
/** Notas de crédito. */
export type CreditNotes = DocumentIssuer<CreateCreditNote>
/** Notas de débito. */
export type DebitNotes = DocumentIssuer<CreateDebitNote>
/** Liquidaciones de compra. */
export type PurchaseSettlements = DocumentIssuer<CreatePurchaseSettlement>
/** Guías de remisión. */
export type Waybills = DocumentIssuer<CreateWaybill>
/** Comprobantes de retención. */
export type Withholdings = DocumentIssuer<CreateWithholding>

/** Every issued document, of any type: search, XML, RIDE (PDF) and email. */
export class Documents extends APIResource {
  /** Lists documents, newest first, with optional filters. */
  list(params?: DocumentListParams, options?: RequestOptions): PagePromise<Document> {
    return this._list('/v1/documents', params, options)
  }

  /** Retrieves a document with its tax status, SRI messages, RIDE and email state. */
  get(documentId: string, options?: RequestOptions): APIPromise<Document> {
    return this._get(pathOf`/v1/documents/${documentId}`, options)
  }

  /**
   * The document's XML: the authorized one once the SRI authorizes it, otherwise the signed
   * or unsigned one (see `kind`).
   */
  xml(documentId: string, options?: RequestOptions): APIPromise<DocumentXml> {
    const result = this.http.request<string>({
      method: 'GET',
      path: pathOf`/v1/documents/${documentId}/xml`,
      accept: 'application/xml, application/problem+json',
      responseType: 'text',
      options,
    })
    return new APIPromise(
      result.then(({ data, response, requestId }) => ({
        data: { xml: data, kind: xmlKind(response.headers.get('flashpi-xml-kind')) },
        response,
        requestId,
      })),
    )
  }

  /**
   * The RIDE (the printable PDF) of an authorized document. Throws a ConflictError with code
   * `ride_not_available` while it is still being generated.
   */
  pdf(documentId: string, options?: RequestOptions): APIPromise<Uint8Array> {
    return this._call<Uint8Array>({
      method: 'GET',
      path: pathOf`/v1/documents/${documentId}/pdf`,
      accept: 'application/pdf, application/problem+json',
      responseType: 'bytes',
      options,
    })
  }

  /**
   * Emails the authorized document (RIDE and XML) again to the address of its request. The
   * new delivery shows in `email.deliveries`; daily limits apply (RateLimitError).
   */
  sendEmail(documentId: string, options?: RequestOptions): APIPromise<Document> {
    return this._post(pathOf`/v1/documents/${documentId}/email`, {}, options)
  }
}

function xmlKind(value: string | null): DocumentXml['kind'] {
  return value === 'authorized' || value === 'signed' || value === 'unsigned' ? value : null
}
