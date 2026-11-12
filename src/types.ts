/**
 * Public types. The resource types come from the API's OpenAPI document (src/generated); the
 * ones below are written by hand where the document cannot express them, such as the events
 * whose `data` depends on their `type`.
 */
import type {
  AccountEmailSending,
  Certificate,
  Document,
  Event as ApiEvent,
  WebhookEndpointVerificationEvent,
  operations,
} from './generated/openapi'

export type {
  AccountEmailSending,
  AccountEmailSendingWindow,
  Certificate,
  CertificateRejection,
  CertificateRevocation,
  CompletedIssuerOnboarding,
  CompleteIssuerOnboarding,
  CreateCreditNote,
  CreateDebitNote,
  CreateEmissionPoint,
  CreateEstablishment,
  CreateInvoice,
  CreateIssuer,
  CreatePurchaseSettlement,
  CreateWaybill,
  CreateWebhookEndpoint,
  CreateWithholding,
  DebitNoteReason,
  Document,
  DocumentAuthorization,
  DocumentCounterparty,
  DocumentEmail,
  DocumentEmailDelivery,
  DocumentEmailWarning,
  DocumentFailure,
  DocumentItem,
  DocumentOptions,
  DocumentParty,
  DocumentPayment,
  DocumentRide,
  DocumentSriMessage,
  DocumentTax,
  DocumentTaxTotal,
  DocumentTotals,
  EmissionPoint,
  ErrorCode,
  Establishment,
  FieldError,
  Issuer,
  IssuerBranding,
  IssuerBrandingInput,
  IssuerOnboarding,
  IssuerOnboardingCertificate,
  IssuerOnboardingCompletion,
  IssuerOnboardingExistingIssuer,
  IssuerOnboardingHolder,
  IssuerOnboardingIdentification,
  IssuerOnboardingIssuingCa,
  IssuerOnboardingPrefill,
  IssuerOnboardingPrefillTaxProfile,
  IssuerOnboardingRejection,
  IssuerOnboardingSri,
  IssuerOnboardingSriProfile,
  IssuerTaxProfile,
  IssuerTaxProfileInput,
  IssuerTaxProfilePatch,
  ModifiedDocument,
  Pagination,
  ProblemDetails,
  RotateWebhookEndpointSecret,
  Status,
  SupportingDocument,
  SupportingDocumentTax,
  UpdateEstablishment,
  UpdateIssuer,
  UpdateWebhookEndpoint,
  WaybillCarrier,
  WaybillItem,
  WaybillRecipient,
  WaybillSupportingDocument,
  WebhookDelivery,
  WebhookDeliveryAttempt,
  WebhookDeliveryDetail,
  WebhookEndpoint,
  WebhookEndpointSecret,
  WebhookEndpointVerification,
  WebhookEndpointVerificationEvent,
  WithheldSubject,
  Withholding,
  WithholdingBananaBoxes,
  WithholdingDividends,
  WithholdingForeignPayment,
  WithholdingPayment,
} from './generated/openapi'

export type { paths, components, operations, webhooks } from './generated/openapi'

/** `test` (SRI pruebas, fp_test_ keys) or `live` (SRI production, fp_live_ keys). */
export type Environment = Document['environment']

/** The six document types: invoice, credit_note, debit_note, purchase_settlement, waybill, withholding. */
export type DocumentType = Document['type']

/** Tax status of a document: processing → pending_sri → authorized | rejected | failed, or voided. */
export type DocumentStatus = Document['status']

/** Every event type the API sends today. New types may appear: keep a default branch. */
export type EventType = ApiEvent['type']

/** Events about a document: its tax outcome (`invoice.authorized`, ...), RIDE and email. */
export type DocumentEventType = Extract<
  EventType,
  `${DocumentType}.${string}` | `document.${string}`
>

/** Events about a .p12 certificate (`certificate.verified`, `certificate.revoked`, ...). */
export type CertificateEventType = Extract<EventType, `certificate.${string}`>

/** Events about the account's email sending (`account.email_paused`, `account.email_resumed`). */
export type AccountEventType = Extract<EventType, `account.${string}`>

interface EventEnvelope<Type extends EventType, Data> {
  /** The event id (UUIDv7), also sent as the `webhook-id` header: deduplicate on it. */
  id: string
  type: Type
  environment: Environment
  /** When the event happened (ISO 8601). */
  createdAt: string
  /** The resource as the API returned it when the event happened (texts in English). */
  data: Data
}

/** An event about a document. `data` is the document. */
export type DocumentEvent = EventEnvelope<DocumentEventType, Document>

/** An event about a certificate. `data` is the certificate. */
export type CertificateEvent = EventEnvelope<CertificateEventType, Certificate>

/** An event about the account's email sending. `data` is the sending state. */
export type AccountEvent = EventEnvelope<AccountEventType, AccountEmailSending>

/**
 * An event, as `events.get()` returns it and webhooks deliver it. Narrow it on `type`:
 *
 * ```ts
 * if (event.type === 'invoice.authorized') console.log(event.data.accessKey)
 * ```
 */
export type Event = DocumentEvent | CertificateEvent | AccountEvent

/** The body of a webhook endpoint in thin mode: the event without `data`. */
export interface ThinEvent {
  id: string
  type: EventType
  environment: Environment
  createdAt: string
}

/**
 * What a webhook endpoint in full mode receives: an event, or the activation handshake
 * (`webhook_endpoint.verification`), which must be answered with `{ "challenge": data.challenge }`.
 */
export type WebhookEvent = Event | WebhookEndpointVerificationEvent

/** What a webhook endpoint in thin mode receives. */
export type ThinWebhookEvent = ThinEvent | WebhookEndpointVerificationEvent

type QueryOf<Operation extends keyof operations> = NonNullable<
  operations[Operation]['parameters']['query']
>

/** Filters of `documents.list()`. */
export type DocumentListParams = QueryOf<'documentsList'>
/** Filters of `events.list()`. */
export type EventListParams = QueryOf<'eventsList'>
/** Filters of `webhookEndpoints.deliveries.list()`. */
export type WebhookDeliveryListParams = QueryOf<'webhookEndpointsDeliveriesList'>
/** Paging of `issuers.list()`. */
export type IssuerListParams = QueryOf<'issuersList'>
/** Paging of `issuers.establishments.list()`. */
export type EstablishmentListParams = QueryOf<'establishmentsList'>
/** Paging of `issuers.establishments.emissionPoints.list()`. */
export type EmissionPointListParams = QueryOf<'emissionPointsList'>
/** Paging of `issuers.certificates.list()`. */
export type CertificateListParams = QueryOf<'certificatesList'>
/** Paging of `webhookEndpoints.list()`. */
export type WebhookEndpointListParams = QueryOf<'webhookEndpointsList'>

/** A .p12 certificate file and its password, for `issuers.certificates.upload()` and `issuerOnboardings.create()`. */
export interface CertificateUpload {
  /** The .p12 (PKCS #12) file, up to 1 MiB. */
  file: Blob | Uint8Array | ArrayBuffer
  /** The certificate's password (sent to Flashpi only, never stored in plain text). */
  password: string
  /** File name sent with the upload (default `certificate.p12`). */
  filename?: string
}

/** The XML of a document and which stage it comes from. */
export interface DocumentXml {
  /** The XML text. */
  xml: string
  /**
   * `authorized` (the SRI's authorization with the document inside), `signed` (sent, not yet
   * authorized) or `unsigned` (before signing). Only `authorized` is the valid tax document.
   */
  kind: 'authorized' | 'signed' | 'unsigned' | null
}
