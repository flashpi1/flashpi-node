import type { APIPromise } from '../core/api-promise'
import { pathOf, type RequestOptions } from '../core/http'
import type { PagePromise } from '../core/pagination'
import { APIResource } from '../core/resource'
import type {
  CreateWebhookEndpoint,
  RotateWebhookEndpointSecret,
  UpdateWebhookEndpoint,
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookDeliveryListParams,
  WebhookEndpoint,
  WebhookEndpointListParams,
  WebhookEndpointSecret,
} from '../types'

/**
 * The URLs Flashpi sends events to. Needs an account-scoped API key with read_write access.
 * To check the signature of a webhook you receive, use `flashpi.webhooks` instead.
 */
export class WebhookEndpoints extends APIResource {
  /** The deliveries of an endpoint: attempts, answers and manual replays. */
  readonly deliveries: WebhookDeliveries = new WebhookDeliveries(this.http)

  /**
   * Creates an endpoint. It stays `pending_verification` until it answers the activation
   * challenge; read its secret with `getSecret()` first, then call `verify()` if needed.
   */
  create(body: CreateWebhookEndpoint, options?: RequestOptions): APIPromise<WebhookEndpoint> {
    return this._post('/v1/webhook-endpoints', body, options)
  }

  list(params?: WebhookEndpointListParams, options?: RequestOptions): PagePromise<WebhookEndpoint> {
    return this._list('/v1/webhook-endpoints', params, options)
  }

  get(endpointId: string, options?: RequestOptions): APIPromise<WebhookEndpoint> {
    return this._get(pathOf`/v1/webhook-endpoints/${endpointId}`, options)
  }

  /** Updates the URL, events, payload mode, description or `disabled` (only the fields sent). */
  update(
    endpointId: string,
    body: UpdateWebhookEndpoint,
    options?: RequestOptions,
  ): APIPromise<WebhookEndpoint> {
    return this._patch(pathOf`/v1/webhook-endpoints/${endpointId}`, body, options)
  }

  delete(endpointId: string, options?: RequestOptions): APIPromise<void> {
    return this._delete(pathOf`/v1/webhook-endpoints/${endpointId}`, options)
  }

  /** The signing secret (`whsec_...`) and, during a rotation, when the previous one expires. */
  getSecret(endpointId: string, options?: RequestOptions): APIPromise<WebhookEndpointSecret> {
    return this._get(pathOf`/v1/webhook-endpoints/${endpointId}/secret`, options)
  }

  /**
   * Replaces the signing secret. The previous one keeps signing for
   * `previousSecretExpiresInHours` (24 by default, 0 to drop it at once). Read the new secret
   * with `getSecret()`.
   */
  rotateSecret(
    endpointId: string,
    body?: RotateWebhookEndpointSecret,
    options?: RequestOptions,
  ): APIPromise<WebhookEndpoint> {
    return this._post(pathOf`/v1/webhook-endpoints/${endpointId}/rotate-secret`, body, options)
  }

  /** Sends the activation challenge (`webhook_endpoint.verification`) to the endpoint again. */
  verify(endpointId: string, options?: RequestOptions): APIPromise<WebhookEndpoint> {
    return this._post(pathOf`/v1/webhook-endpoints/${endpointId}/verify`, undefined, options)
  }
}

/** Deliveries of events to one endpoint. */
export class WebhookDeliveries extends APIResource {
  /** Lists deliveries, newest first, optionally by status, event type or event. */
  list(
    endpointId: string,
    params?: WebhookDeliveryListParams,
    options?: RequestOptions,
  ): PagePromise<WebhookDelivery> {
    return this._list(pathOf`/v1/webhook-endpoints/${endpointId}/deliveries`, params, options)
  }

  /** Retrieves a delivery with its attempts. */
  get(
    endpointId: string,
    deliveryId: string,
    options?: RequestOptions,
  ): APIPromise<WebhookDeliveryDetail> {
    return this._get(pathOf`/v1/webhook-endpoints/${endpointId}/deliveries/${deliveryId}`, options)
  }

  /** Sends the delivery's event again, with the same `webhook-id`. */
  replay(
    endpointId: string,
    deliveryId: string,
    options?: RequestOptions,
  ): APIPromise<WebhookDeliveryDetail> {
    return this._post(
      pathOf`/v1/webhook-endpoints/${endpointId}/deliveries/${deliveryId}/replay`,
      undefined,
      options,
    )
  }
}
