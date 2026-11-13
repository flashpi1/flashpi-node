// Downloads a text document over HTTPS only (scripts/openapi.mjs uses it for the contract).
//
// fetch follows redirects by itself, to plain http:// too, where anyone on the way can change
// what is downloaded. So redirects are followed here, by hand: only to https:// URLs, each one
// checked before it is requested, and at most MAX_REDIRECTS in a row.

/** The redirect statuses fetch would follow. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** The most redirects followed for one download. */
export const MAX_REDIRECTS = 5

/**
 * The text at `url`, an https:// URL. Throws before requesting a URL that is not https://,
 * whether it is `url` or the Location of a redirect.
 *
 * @param {string} url
 * @param {{ fetch?: typeof globalThis.fetch, headers?: Record<string, string> }} [options]
 * @returns {Promise<string>}
 */
export async function downloadText(url, { fetch = globalThis.fetch, headers = {} } = {}) {
  let current = url
  for (let redirects = 0; ; redirects++) {
    if (!isHttps(current)) {
      throw new Error(
        redirects === 0
          ? `Refusing to download from a URL that is not https://: ${current}`
          : `Refusing a redirect to a URL that is not https://: ${current}`,
      )
    }
    const response = await fetch(current, { headers, redirect: 'manual' })
    if (!REDIRECT_STATUSES.has(response.status)) {
      if (!response.ok) throw new Error(`GET ${current} answered ${response.status}`)
      return response.text()
    }
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (location === null) {
      throw new Error(`GET ${current} answered ${response.status} without a Location`)
    }
    if (redirects === MAX_REDIRECTS) {
      throw new Error(`GET ${url} redirected more than ${MAX_REDIRECTS} times`)
    }
    const next = parseUrl(location, current)
    if (next === null) {
      throw new Error(`GET ${current} redirected to an invalid URL: ${location}`)
    }
    current = next.href
  }
}

/** @param {string} url */
function isHttps(url) {
  return parseUrl(url)?.protocol === 'https:'
}

/**
 * @param {string} url
 * @param {string} [base]
 */
function parseUrl(url, base) {
  try {
    return new URL(url, base)
  } catch {
    return null
  }
}
