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

/**
 * Headers fetch handles itself, with why a caller cannot set them. Content-Length and
 * Transfer-Encoding frame the body: another value would frame it wrongly. Node.js's fetch
 * refuses Keep-Alive, Upgrade and Expect while sending; Bun hangs on Upgrade and Workers on
 * Expect.
 */
const FETCH_HEADERS = new Map([
  ['content-length', 'fetch sets it from the body'],
  ['transfer-encoding', 'fetch sets it from the body'],
  ['keep-alive', 'fetch manages it'],
  ['upgrade', 'fetch manages it'],
  ['expect', 'fetch manages it'],
])

/**
 * A header value as `Headers` sends it: as text, without the spaces, tabs and line breaks around
 * it. Throws a TypeError when a line break or another control character other than a tab is left
 * inside; its message names `label`, never the value, which may be a secret. Characters above
 * U+00FF are left to `Headers`, which refuses them on Node.js and Bun and sends them as UTF-8 on
 * Workers.
 */
export function headerValue(label: string, value: string): string {
  // JavaScript callers may pass other values: turned into text once, as Headers would, so the
  // text checked is the text sent. Headers cannot turn a symbol into text either.
  const raw: unknown = value
  if (typeof raw === 'symbol') throw new TypeError(`${label} is a symbol, not text`)
  const trimmed = trimHttpWhitespace(typeof raw === 'string' ? raw : String(raw))
  if (CONTROL_CHARACTER.test(trimmed)) {
    throw new TypeError(`${label} has a line break or another control character`)
  }
  return trimmed
}

/**
 * The headers a caller adds (`headers`, `defaultHeaders`), checked: every value with
 * {@link headerValue}, and none of the headers fetch handles itself (Content-Length,
 * Transfer-Encoding, Keep-Alive, Upgrade, Expect: a TypeError). Returns a copy with the values as they are sent, so requests are built
 * from what was checked even if the caller changes the object afterwards.
 */
export function checkHeaders(
  label: string,
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const checked: [string, string][] = []
  for (const [name, value] of Object.entries(headers ?? {})) {
    const handledByFetch = FETCH_HEADERS.get(name.toLowerCase())
    if (handledByFetch !== undefined) {
      throw new TypeError(`${label} cannot carry ${JSON.stringify(name)}: ${handledByFetch}`)
    }
    checked.push([
      name,
      headerValue(`The value of the ${JSON.stringify(name)} header in ${label}`, value),
    ])
  }
  // fromEntries defines every name as its own property, even "__proto__".
  return Object.fromEntries(checked)
}
