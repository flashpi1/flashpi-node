export { Flashpi } from './client'
export type { ClientOptions } from './client'

export { APIPromise } from './core/api-promise'
export type { WithResponse } from './core/api-promise'
export {
  APIError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ConnectionError,
  FlashpiError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  TimeoutError,
  UnprocessableEntityError,
  WebhookVerificationError,
} from './core/errors'
export type { ApiErrorCode, Problem, WebhookVerificationReason } from './core/errors'
export type { Fetch, Language, RequestOptions } from './core/http'
export { Page, PagePromise } from './core/pagination'
export type { PageParams } from './core/pagination'

export type { DocumentIssuer, Documents } from './resources/documents'
export type {
  CreditNotes,
  DebitNotes,
  Invoices,
  PurchaseSettlements,
  Waybills,
  Withholdings,
} from './resources/documents'
export type { Events } from './resources/events'
export type { IssuerOnboardings } from './resources/issuer-onboardings'
export type { Certificates, EmissionPoints, Establishments, Issuers } from './resources/issuers'
export type { Status as StatusResource } from './resources/status'
export type { WebhookDeliveries, WebhookEndpoints } from './resources/webhook-endpoints'

export {
  unwrapWebhook,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
  Webhooks,
} from './webhooks'
export type { WebhookHeaders, WebhookPayload, WebhookVerifyOptions } from './webhooks'

export type * from './types'

export { VERSION } from './version'
