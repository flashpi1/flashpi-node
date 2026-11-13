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
 * A lone surrogate (half of a pair: a character outside the BMP cut in two). It has no UTF-8:
 * Workers sends it as ill-formed bytes; Node.js and Bun refuse it.
 */
const LONE_SURROGATE = /[\ud800-\udfff]/u

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
 * inside, or a lone surrogate, or a character the runtime's `Headers` refuses (characters above
 * U+00FF on Node.js and Bun; Workers sends them as UTF-8). Its message names `label`, never the
 * value, which may be a secret (Bun's `Headers` quotes it).
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
  if (LONE_SURROGATE.test(trimmed)) {
    throw new TypeError(`${label} has a character that cannot be sent as UTF-8`)
  }
  try {
    new Headers().set('x', trimmed)
  } catch {
    throw new TypeError(
      `${label} has a character this runtime cannot send in a header, such as one above U+00FF`,
    )
  }
  return trimmed
}

/**
 * Headers in any shape `new Headers()` takes: a plain object, a `Headers` instance, or
 * `[name, value]` pairs (an array, a `Map` or another iterable). The last member is what
 * `new Headers()` takes in the consumer's own types (the DOM library, @types/node, Bun's or
 * Workers' types), so a value typed as that `HeadersInit` fits too, with or without the DOM
 * library. Exported, so a consumer's declarations name it instead of the runtime's `HeadersInit`
 * (with only @types/node, undici-types' one, which a pnpm project cannot name).
 *
 * To read one, pass it to `new Headers()`, which takes every shape. TypeScript's types for that
 * constructor take no `Map`, generator or read-only array, so the call needs a cast:
 * `new Headers(headers as ConstructorParameters<typeof Headers>[0])`. Spreading one
 * (`{ ...headers }`) drops a `Headers` instance or a `Map` and turns pairs into headers named
 * `0`, `1`, ....
 */
export type HeadersLike =
  | Record<string, string>
  | Headers
  | Iterable<readonly [string, string]>
  | NonNullable<ConstructorParameters<typeof Headers>[0]>

/**
 * The headers a caller adds (`headers`, `defaultHeaders`), in any shape `Headers` takes, checked:
 * every value with {@link headerValue}, and none of the headers fetch handles itself
 * (Content-Length, Transfer-Encoding, Keep-Alive, Upgrade, Expect: a TypeError). Read once, into
 * a new `Headers` with the values as they are sent, so requests are built from what was checked
 * even if the caller changes the original afterwards.
 *
 * Pairs follow `Headers`: a name given twice gets both values, joined with ", ". A plain object
 * keeps the last of two names that differ only in case, as the SDK always did.
 */
export function checkHeaders(label: string, headers: HeadersLike | undefined): Headers {
  const checked = new Headers()
  // JavaScript callers may pass null, which the SDK always read as no headers.
  const raw: unknown = headers ?? {}
  if (Object(raw) !== raw) {
    throw new TypeError(`${label} must be an object, a Headers instance or [name, value] pairs`)
  }
  // An iterable is pairs, as Headers reads it (a Headers instance, an array, a Map).
  if (typeof (raw as Partial<Iterable<unknown>>)[Symbol.iterator] === 'function') {
    for (const entry of raw as Iterable<unknown>) {
      const [name, value] = pairOf(label, entry)
      checked.append(name, checkedValue(label, name, value))
    }
  } else {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      checked.set(checkedName(label, name), checkedValue(label, name, value))
    }
  }
  return checked
}

/**
 * Whether `value` is an iterator (it has `next()`, like a generator or `map.entries()`), which
 * gives its items only once: headers kept for later requests are kept as the copy read from it.
 */
export function isIterator(value: unknown): boolean {
  return typeof (value as { next?: unknown } | null | undefined)?.next === 'function'
}

/** One `[name, value]` pair of `headers` given as pairs: exactly two items, as Headers wants. */
function pairOf(label: string, entry: unknown): [string, unknown] {
  const items =
    Object(entry) === entry &&
    typeof (entry as Partial<Iterable<unknown>>)[Symbol.iterator] === 'function'
      ? Array.from(entry as Iterable<unknown>)
      : []
  if (items.length !== 2) {
    // Never the entry: it may hold a value (Node.js's Headers quotes one that is text).
    throw new TypeError(`${label} has an entry that is not a [name, value] pair`)
  }
  const name: unknown = items[0]
  // Headers cannot turn a symbol into text either.
  if (typeof name === 'symbol') throw new TypeError(`${label} has a header name that is a symbol`)
  return [checkedName(label, String(name)), items[1]]
}

/** `name`, unless it is one of the headers fetch handles itself (a TypeError). */
function checkedName(label: string, name: string): string {
  const handledByFetch = FETCH_HEADERS.get(name.toLowerCase())
  if (handledByFetch !== undefined) {
    throw new TypeError(`${label} cannot carry ${JSON.stringify(name)}: ${handledByFetch}`)
  }
  return name
}

function checkedValue(label: string, name: string, value: unknown): string {
  return headerValue(`The value of the ${JSON.stringify(name)} header in ${label}`, value as string)
}
