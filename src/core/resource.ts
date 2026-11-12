import { APIPromise, type WithResponse } from './api-promise'
import type { HttpClient, RequestOptions, RequestSpec } from './http'
import { type ListBody, Page, type PageParams, PagePromise } from './pagination'

/** Base of every resource: the shared HTTP client and small request helpers. */
export abstract class APIResource {
  protected readonly http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  protected _call<T>(spec: RequestSpec<T>): APIPromise<T> {
    return new APIPromise(this.http.request(spec))
  }

  protected _get<T>(path: string, options?: RequestOptions): APIPromise<T> {
    return this._call<T>({ method: 'GET', path, options })
  }

  protected _post<T>(path: string, body: unknown, options?: RequestOptions): APIPromise<T> {
    return this._call<T>({ method: 'POST', path, body, options })
  }

  protected _patch<T>(path: string, body: unknown, options?: RequestOptions): APIPromise<T> {
    return this._call<T>({ method: 'PATCH', path, body, options })
  }

  protected _delete(path: string, options?: RequestOptions): APIPromise<void> {
    return this._call<undefined>({ method: 'DELETE', path, responseType: 'none', options })
  }

  /** A list call whose result is the first page and iterates every page. */
  protected _list<T>(
    path: string,
    params: PageParams | undefined,
    options?: RequestOptions,
  ): PagePromise<T> {
    const fetchPage = async (cursor: string | undefined): Promise<WithResponse<Page<T>>> => {
      const query = { ...params, cursor }
      const result = await this.http.request<ListBody<T>>({ method: 'GET', path, query, options })
      const page = new Page<T>(result.data, (next) => fetchPage(next))
      return { data: page, response: result.response, requestId: result.requestId }
    }
    return new PagePromise(fetchPage(params?.cursor))
  }
}
