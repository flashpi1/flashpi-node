/** The most redirects followed for one download. */
export declare const MAX_REDIRECTS: number

/** Options of {@link downloadText}. */
export interface DownloadOptions {
  /** A `fetch` implementation (the runtime's global `fetch` by default). */
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  /** Headers sent with every request. */
  headers?: Record<string, string>
}

/**
 * The text at `url`, an https:// URL. Throws before requesting a URL that is not https://,
 * whether it is `url` or the Location of a redirect.
 */
export declare function downloadText(url: string, options?: DownloadOptions): Promise<string>
