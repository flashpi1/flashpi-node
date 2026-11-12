/** The data of an answer together with the HTTP response it came from. */
export interface WithResponse<T> {
  data: T
  response: Response
  /** Flashpi's id of the request (`x-request-id`): share it with support. */
  requestId: string | null
}

/**
 * The result of an API call. Await it for the data, or call `withResponse()` to also get the
 * HTTP response (status, headers, request id).
 *
 * The request starts as soon as the method is called, like any promise.
 */
export class APIPromise<T> implements PromiseLike<T> {
  readonly #result: Promise<WithResponse<T>>

  constructor(result: Promise<WithResponse<T>>) {
    this.#result = result
  }

  /** The data plus the HTTP response and Flashpi's request id. */
  withResponse(): Promise<WithResponse<T>> {
    return this.#result
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.#result.then((result) => result.data).then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.then(undefined, onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.then().finally(onfinally)
  }

  readonly [Symbol.toStringTag]: string = 'APIPromise'
}
