import type { APIPromise } from '../core/api-promise'
import { pathOf, type RequestOptions } from '../core/http'
import type { PagePromise } from '../core/pagination'
import { APIResource } from '../core/resource'
import type { Event, EventListParams } from '../types'

/** Events: what happened to documents, certificates and email sending, newest first. */
export class Events extends APIResource {
  /** Lists events, optionally by type, issuer, document or certificate. */
  list(params?: EventListParams, options?: RequestOptions): PagePromise<Event> {
    return this._list('/v1/events', params, options)
  }

  /** Retrieves an event: the same object its webhook delivered. */
  get(eventId: string, options?: RequestOptions): APIPromise<Event> {
    return this._get(pathOf`/v1/events/${eventId}`, options)
  }
}
