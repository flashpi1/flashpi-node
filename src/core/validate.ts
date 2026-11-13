import { FlashpiError } from './errors'

/** The longest delay `setTimeout` keeps; longer ones fire at once on every runtime. */
export const MAX_TIMEOUT_MS = 2_147_483_647

/** A timeout in milliseconds: more than 0 and at most {@link MAX_TIMEOUT_MS}. */
export function validTimeout(name: string, value: number): number {
  if (typeof value !== 'number' || !(value > 0 && value <= MAX_TIMEOUT_MS)) {
    throw new FlashpiError(`${name} must be between 1 and ${MAX_TIMEOUT_MS} milliseconds`)
  }
  return value
}

/** A number of retries: a whole number, 0 or more. */
export function validRetries(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new FlashpiError(`${name} must be a whole number, 0 or more`)
  }
  return value
}

/** Spaces, tabs and line breaks: `Headers` trims them from both ends of a value. */
function isHttpWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20
}

/**
 * `value` without the HTTP whitespace at both ends, in linear time. (A regular expression such
 * as `/^[\t\n\r ]+|[\t\n\r ]+$/g` takes quadratic time on a long run of inner spaces.)
 */
function trimHttpWhitespace(value: string): string {
  let start = 0
  let end = value.length
  while (end > start && isHttpWhitespace(value.charCodeAt(end - 1))) end--
  while (start < end && isHttpWhitespace(value.charCodeAt(start))) start++
  return value.slice(start, end)
}

/**
 * Control characters other than the tab. `Headers` refuses a line break or a NUL at once,
 * quoting the value; the others pass it, then Node.js's fetch fails while sending (a network
 * error) and Bun and Workers send them.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\x00-\x08\x0a-\x1f\x7f]/

/** Headers fetch sets from the body: another value would frame it wrongly. */
const FRAMING_HEADERS = new Set(['content-length', 'transfer-encoding'])

/**
 * A header value as `Headers` sends it: without the spaces, tabs and line breaks around it.
 * Throws a TypeError when a line break or another control character other than a tab is left
 * inside; its message names `label`, never the value, which may be a secret. Characters above
 * U+00FF are left to `Headers`, which refuses them on Node.js and Bun and sends them as UTF-8 on
 * Workers.
 */
export function headerValue(label: string, value: string): string {
  // JavaScript callers may pass other values; Headers turns them into text.
  const raw: unknown = value
  if (typeof raw !== 'string') return value
  const trimmed = trimHttpWhitespace(raw)
  if (CONTROL_CHARACTER.test(trimmed)) {
    throw new TypeError(`${label} has a line break or another control character`)
  }
  return trimmed
}

/**
 * Checks the headers a caller adds (`headers`, `defaultHeaders`): every value with
 * {@link headerValue}, and no Content-Length or Transfer-Encoding, which fetch sets from the
 * body (a TypeError).
 */
export function checkHeaders(label: string, headers: Record<string, string> | undefined): void {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (FRAMING_HEADERS.has(name.toLowerCase())) {
      throw new TypeError(
        `${label} cannot carry ${JSON.stringify(name)}: fetch sets it from the body`,
      )
    }
    headerValue(`The value of the ${JSON.stringify(name)} header in ${label}`, value)
  }
}
