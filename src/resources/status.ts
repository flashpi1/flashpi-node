import type { APIPromise } from '../core/api-promise'
import type { RequestOptions } from '../core/http'
import { APIResource } from '../core/resource'
import type { Status as ApiStatus } from '../types'

/** The API's own status. It needs no API key. */
export class Status extends APIResource {
  get(options?: RequestOptions): APIPromise<ApiStatus> {
    return this._get('/v1/status', options)
  }
}
