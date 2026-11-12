import type { Pagination } from '../generated/openapi'
import { APIPromise, type WithResponse } from './api-promise'

/** The body of every list operation of the API. */
export interface ListBody<T> {
  data: T[]
  pagination: Pagination
}

/** Query parameters every list operation accepts. */
export interface PageParams {
  /** Items per page, 1 to 100 (the API's default is 20). */
  limit?: number
  /** The `nextCursor` of the previous page. */
  cursor?: string
}

type FetchPage<T> = (cursor: string) => Promise<WithResponse<Page<T>>>

/**
 * One page of a list, newest first (establishments and emission points: by code). Iterate it
 * with `for await` to walk this page and every following one.
 */
export class Page<T> implements AsyncIterable<T> {
  /** The items of this page. */
  readonly data: T[]
  /** Whether more items follow this page. */
  readonly hasMore: boolean
  /** The cursor of the next page, or `null` on the last one. */
  readonly nextCursor: string | null
  readonly #fetchPage: FetchPage<T>

  constructor(body: ListBody<T>, fetchPage: FetchPage<T>) {
    this.data = body.data
    this.hasMore = body.pagination.hasMore
    this.nextCursor = body.pagination.nextCursor
    this.#fetchPage = fetchPage
  }

  /** Whether `nextPage()` will return a page. */
  hasNextPage(): boolean {
    return this.hasMore && this.nextCursor !== null
  }

  /** The next page (same filters and options), or `null` after the last page. */
  async nextPage(): Promise<Page<T> | null> {
    if (!this.hasNextPage() || this.nextCursor === null) return null
    const { data } = await this.#fetchPage(this.nextCursor)
    return data
  }

  /** Every item of this page and the following pages, fetching them as needed. */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (const item of this.data) yield item
    let page = await this.nextPage()
    while (page) {
      for (const item of page.data) yield item
      page = await page.nextPage()
    }
  }
}

/**
 * The result of a list call. Await it for the first page, or iterate it with `for await` to
 * walk every item across pages:
 *
 * ```ts
 * for await (const document of flashpi.documents.list({ status: 'authorized' })) {
 *   console.log(document.accessKey)
 * }
 * ```
 */
export class PagePromise<T> extends APIPromise<Page<T>> implements AsyncIterable<T> {
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    const page = await this
    yield* page
  }
}
