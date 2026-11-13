/**
 * Regression tests for the hardening after the Python SDK's reviews (2026-11-13): defects the two
 * reviews of flashpi-python found that the Node.js SDK had too, and the owner's answers to it
 * (headers in every shape `new Headers()` takes).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ConnectionError, Flashpi, FlashpiError, type RequestOptions } from '../src'
import { ID, TEST_KEY, client, json, mockFetch, page, problem } from './support'

afterEach(() => {
  vi.unstubAllEnvs()
})

/** The error thrown by `run`, which must throw. */
function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('Expected an error')
}

/** Asserts that no six characters in a row of `secret` show up anywhere in the error. */
function expectNothingOf(secret: string, error: unknown): void {
  const shown = error instanceof Error ? [error.message, String(error), error.stack ?? ''] : []
  shown.push(String(error), error instanceof Error ? String(error.cause) : '')
  for (let start = 0; start + 6 <= secret.length; start++) {
    const part = secret.slice(start, start + 6)
    for (const text of shown) expect(text).not.toContain(part)
  }
}

describe('API keys with characters an API key cannot have', () => {
  const body = 'Q7vXk2Lm9PZr4Wt8Yn1S'
  const bad = {
    'a line break': `fp_test_${body.slice(0, 10)}\n${body.slice(10)}`,
    'a carriage return': `fp_test_${body.slice(0, 10)}\r${body.slice(10)}`,
    'a NUL': `fp_test_${body.slice(0, 10)}\0${body.slice(10)}`,
    'a space': `fp_live_${body.slice(0, 10)} ${body.slice(10)}`,
    'a tab': `fp_live_${body.slice(0, 10)}\t${body.slice(10)}`,
    'a vertical tab': `fp_test_${body.slice(0, 10)}\x0b${body.slice(10)}`,
    'a DEL': `fp_test_${body.slice(0, 10)}\x7f${body.slice(10)}`,
    'a letter outside ASCII': `fp_test_${body.slice(0, 10)}\u00e9${body.slice(10)}`,
    'a no-break space': `fp_test_${body.slice(0, 10)}\u00a0${body.slice(10)}`,
  }

  for (const [what, key] of Object.entries(bad)) {
    it(`refuses a key with ${what} when the client is created, without showing it`, () => {
      const { fetch, sent } = mockFetch()
      const error = thrownBy(() => new Flashpi(key, { fetch }))
      expect(error).toBeInstanceOf(FlashpiError)
      expect((error as FlashpiError).message).toMatch(/characters an API key cannot have/)
      expect((error as FlashpiError).cause).toBeUndefined()
      expectNothingOf(key, error)
      expect(sent).toHaveLength(0)
    })
  }

  it('refuses one read from FLASHPI_API_KEY the same way', () => {
    const key = bad['a line break']
    vi.stubEnv('FLASHPI_API_KEY', key)
    const error = thrownBy(() => new Flashpi())
    expect(error).toBeInstanceOf(FlashpiError)
    expectNothingOf(key, error)
  })

  it('still trims what String.prototype.trim() trims around the key', async () => {
    const { fetch, sent } = mockFetch(json({ status: 'operational' }))
    const flashpi = new Flashpi(`\ufeff\u00a0 ${TEST_KEY}\r\n\u2028`, { fetch })
    await flashpi.status.get()
    expect(sent[0]?.headers.get('authorization')).toBe(`Bearer ${TEST_KEY}`)
  })

  it('accepts every visible ASCII character after the prefix', () => {
    let visible = ''
    for (let code = 0x21; code <= 0x7e; code++) visible += String.fromCharCode(code)
    expect(new Flashpi(`fp_live_${visible}`).environment).toBe('live')
  })

  it('checks the prefix first, so a webhook secret still gets its own message', () => {
    expect(() => new Flashpi('whsec_abc def')).toThrow(/webhook signing secret/)
    expect(() => new Flashpi('sk_test_abc\ndef')).toThrow(/must start with fp_test_ or fp_live_/)
  })
})

/** The rejection of `promise`, which must reject. */
async function rejectionOf(promise: PromiseLike<unknown>): Promise<unknown> {
  return Promise.resolve(promise).then(
    () => {
      throw new Error('Expected a rejection')
    },
    (error: unknown) => error,
  )
}

/** A secret-looking value with `character` inside. */
const valueWith = (character: string): string => `Zk7QpW${character}Mv3RtY`

const CONTROL_CHARACTERS = {
  'a vertical tab': '\x0b',
  'a form feed': '\x0c',
  'a \\x01': '\x01',
  'a \\x1f': '\x1f',
  'a DEL': '\x7f',
  'a line break': '\n',
  'a carriage return': '\r',
  'a NUL': '\0',
}

describe('header values that fetch refuses only while sending', () => {
  let server: Server
  let baseUrl: string
  const received: IncomingMessage[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      received.push(request)
      response.setHeader('content-type', 'application/json')
      response.end('{"status":"operational"}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  /** A client on the runtime's own fetch, counting the calls. */
  function realClient(): { flashpi: Flashpi; calls: () => number } {
    let calls = 0
    const flashpi = new Flashpi(TEST_KEY, {
      baseUrl,
      maxRetries: 2,
      fetch: (input, init) => {
        calls++
        return globalThis.fetch(input, init)
      },
    })
    return { flashpi, calls: () => calls }
  }

  it('throws a TypeError before sending, instead of a retried network error', async () => {
    received.length = 0
    const { flashpi, calls } = realClient()
    const value = valueWith('\x0b')
    const error = await rejectionOf(flashpi.status.get({ headers: { 'x-trace': value } }))
    expect(error).toBeInstanceOf(TypeError)
    expect((error as TypeError).message).toBe(
      'The value of the "x-trace" header in headers has a line break or another control character',
    )
    expectNothingOf(value, error)
    expect(calls()).toBe(0)
    expect(received).toHaveLength(0)
  })

  it('still sends what fetch sends today: tabs, Latin-1 and trimmed values', async () => {
    received.length = 0
    const { flashpi } = realClient()
    await flashpi.status.get({
      headers: { 'x-tab': 'a\tb', 'x-latin': 'caf\xe9 \x80\xff', 'x-around': ' \t\r\nok\n ' },
      correlationId: '\r\n order-42 \t',
    })
    const headers = received[0]?.headers
    expect(headers?.['x-tab']).toBe('a\tb')
    expect(headers?.['x-latin']).toBe('caf\xe9 \x80\xff')
    expect(headers?.['x-around']).toBe('ok')
    expect(headers?.['x-correlation-id']).toBe('order-42')
  })
})

describe('header values the SDK builds', () => {
  for (const [what, character] of Object.entries(CONTROL_CHARACTERS)) {
    it(`refuses ${what} in every request option that becomes a header`, async () => {
      const value = valueWith(character)
      const { flashpi, sent } = client([])
      const calls = {
        headers: flashpi.status.get({ headers: { 'X-Trace': value } }),
        idempotencyKey: flashpi.invoices.create({} as never, { idempotencyKey: value }),
        correlationId: flashpi.documents.list({}, { correlationId: value }),
        language: flashpi.status.get({ language: value as never }),
      }
      for (const [option, call] of Object.entries(calls)) {
        const error = await rejectionOf(call)
        expect(error).toBeInstanceOf(TypeError)
        expect((error as TypeError).message).toMatch(
          option === 'headers'
            ? /^The value of the "X-Trace" header in headers has a line break or another control character$/
            : new RegExp(`^${option} has a line break or another control character$`),
        )
        expectNothingOf(value, error)
      }
      expect(sent).toHaveLength(0)
    })

    it(`refuses ${what} in the client's settings when the client is created`, () => {
      const value = valueWith(character)
      const { fetch, sent } = mockFetch()
      const inHeaders = thrownBy(
        () => new Flashpi(TEST_KEY, { fetch, defaultHeaders: { 'x-team': value } }),
      )
      expect(inHeaders).toBeInstanceOf(TypeError)
      expect((inHeaders as TypeError).message).toBe(
        'The value of the "x-team" header in defaultHeaders has a line break or another control character',
      )
      expectNothingOf(value, inHeaders)
      const inLanguage = thrownBy(() => new Flashpi(TEST_KEY, { fetch, language: value as never }))
      expect(inLanguage).toBeInstanceOf(TypeError)
      expect((inLanguage as TypeError).message).toBe(
        'language has a line break or another control character',
      )
      expect(sent).toHaveLength(0)
    })
  }

  it('checks defaultHeaders again before each request, in case they changed', async () => {
    const defaultHeaders: Record<string, string> = { 'x-team': 'billing' }
    const { flashpi, sent } = client([], { defaultHeaders })
    defaultHeaders['x-team'] = valueWith('\x01')
    await expect(flashpi.status.get()).rejects.toThrow(TypeError)
    expect(sent).toHaveLength(0)
  })

  it('does not trim a control character that is not HTTP whitespace', async () => {
    const { flashpi, sent } = client([])
    await expect(flashpi.status.get({ headers: { 'x-a': '\x0bvalue' } })).rejects.toThrow(TypeError)
    await expect(flashpi.status.get({ headers: { 'x-a': 'value\x7f' } })).rejects.toThrow(TypeError)
    expect(sent).toHaveLength(0)
  })

  it('puts the trimmed Idempotency-Key on errors, the one it sent', async () => {
    const { flashpi, sent } = client([problem(400, 'validation_failed')])
    const error = await rejectionOf(
      flashpi.invoices.create({} as never, { idempotencyKey: ' \torder-42\r\n ' }),
    )
    expect(sent[0]?.headers.get('idempotency-key')).toBe('order-42')
    expect((error as FlashpiError).idempotencyKey).toBe('order-42')
  })

  it('trims in linear time, whatever the run of spaces or tabs inside a value', async () => {
    // A trimming regular expression took about 6 s on each of these (quadratic time).
    const spaces = `a${' '.repeat(100_000)}b`
    const tabs = `a${'\t'.repeat(100_000)}b`
    const { flashpi, sent } = client([json({})])
    const started = performance.now()
    await flashpi.invoices.create({} as never, {
      idempotencyKey: spaces,
      correlationId: tabs,
      headers: { 'x-trace': spaces },
    })
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(sent[0]?.headers.get('idempotency-key')).toBe(spaces)
    expect(sent[0]?.headers.get('x-correlation-id')).toBe(tabs)
    expect(sent[0]?.headers.get('x-trace')).toBe(spaces)
  })

  it('keeps the client language when a request asks for an empty one', async () => {
    const { flashpi, sent } = client([json({}), json({})], { language: 'es' })
    await flashpi.status.get({ language: '  ' as never })
    const noLanguage = client([json({})], { language: ' \t' as never })
    await noLanguage.flashpi.status.get()
    expect(sent[0]?.headers.get('accept-language')).toBe('es')
    expect(noLanguage.sent[0]?.headers.has('accept-language')).toBe(false)
  })

  it('still lets Headers turn values that are not text into text', async () => {
    const { flashpi, sent } = client([json({})])
    await flashpi.status.get({ headers: { 'x-count': 42 as never }, correlationId: 7 as never })
    expect(sent[0]?.headers.get('x-count')).toBe('42')
    expect(sent[0]?.headers.get('x-correlation-id')).toBe('7')
  })

  const refusedByHeaders = {
    // Node.js and Bun refuse these at once; Bun's TypeError quotes the whole value.
    'a character above U+00FF': [String.fromCharCode(0x20ac), /cannot send in a header/],
    'an emoji': ['\u{1f600}', /cannot send in a header/],
    // Workers would send these as ill-formed UTF-8.
    'a lone high surrogate': ['\ud800', /cannot be sent as UTF-8/],
    'a lone low surrogate': ['\udc00', /cannot be sent as UTF-8/],
    'a surrogate at the end': ['\ud83d', /cannot be sent as UTF-8/],
  } as const

  for (const [what, [character, message]] of Object.entries(refusedByHeaders)) {
    it(`refuses ${what} at once, without showing the value`, async () => {
      const value = valueWith(character)
      const { flashpi, sent } = client([])
      const calls = [
        flashpi.status.get({ headers: { 'x-a': value } }),
        flashpi.invoices.create({} as never, { idempotencyKey: value }),
        flashpi.status.get({ correlationId: value }),
      ]
      for (const call of calls) {
        const error = await rejectionOf(call)
        expect(error).toBeInstanceOf(TypeError)
        expect((error as TypeError).message).toMatch(message)
        expect((error as TypeError).cause).toBeUndefined()
        expectNothingOf(value, error)
      }
      const inDefaults = thrownBy(
        () => new Flashpi(TEST_KEY, { defaultHeaders: { 'x-proxy-token': value } }),
      )
      expect((inDefaults as TypeError).message).toMatch(
        /^The value of the "x-proxy-token" header in defaultHeaders has a character /,
      )
      expectNothingOf(value, inDefaults)
      expect(sent).toHaveLength(0)
    })
  }

  it('does not take a pair of surrogates (an emoji) for a lone one', () => {
    // Workers sends an emoji as UTF-8; Node.js refuses it as above U+00FF.
    const error = thrownBy(() => new Flashpi(TEST_KEY, { defaultHeaders: { 'x-a': '\u{1f600}' } }))
    expect((error as TypeError).message).not.toMatch(/UTF-8/)
  })
})

describe('headers fetch handles itself', () => {
  const handled = {
    'Content-Length': 'fetch sets it from the body',
    'content-length': 'fetch sets it from the body',
    'Transfer-Encoding': 'fetch sets it from the body',
    'TRANSFER-ENCODING': 'fetch sets it from the body',
    // Node.js's fetch refuses these while sending; Bun hangs on Upgrade and Workers on Expect.
    'Keep-Alive': 'fetch manages it',
    upgrade: 'fetch manages it',
    Expect: 'fetch manages it',
  }

  for (const [name, why] of Object.entries(handled)) {
    it(`refuses ${name} in headers and in defaultHeaders`, async () => {
      const { flashpi, sent } = client([])
      const error = await rejectionOf(
        flashpi.invoices.create({ total: 1 } as never, { headers: { [name]: '999' } }),
      )
      expect(error).toBeInstanceOf(TypeError)
      expect((error as TypeError).message).toBe(`headers cannot carry "${name}": ${why}`)
      expect(sent).toHaveLength(0)
      expect(() => new Flashpi(TEST_KEY, { defaultHeaders: { [name]: '999' } })).toThrow(
        new TypeError(`defaultHeaders cannot carry "${name}": ${why}`),
      )
    })
  }

  it('still sends Connection, which fetch sends when it is close or keep-alive', async () => {
    const { flashpi, sent } = client([json({})])
    await flashpi.status.get({ headers: { Connection: 'close' } })
    expect(sent[0]?.headers.get('connection')).toBe('close')
  })
})

/** The error Node.js's fetch (undici) rejects with when it refuses to send a request. */
function fetchRefusal(reason: string, code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(reason), { code }) })
}

describe('a request fetch refuses to send', () => {
  const refusals: [reason: string, code: string][] = [
    ['invalid connection header', 'UND_ERR_INVALID_ARG'],
    ['expect header not supported', 'UND_ERR_NOT_SUPPORTED'],
  ]
  for (const [reason, code] of refusals) {
    it(`is not retried (${code})`, async () => {
      const refusal = fetchRefusal(reason, code)
      const { flashpi, sent } = client([refusal, json({})], { maxRetries: 2 })
      const error = await rejectionOf(
        flashpi.invoices.create({} as never, { idempotencyKey: 'order-42' }),
      )
      expect(sent).toHaveLength(1)
      expect(error).toBeInstanceOf(FlashpiError)
      expect(error).not.toBeInstanceOf(ConnectionError)
      expect((error as FlashpiError).message).toBe(
        `fetch refused to send POST https://api.flashpi.com.ec/v1/invoices: ${reason}`,
      )
      expect((error as FlashpiError).cause).toBe(refusal)
      expect((error as FlashpiError).idempotencyKey).toBe('order-42')
    })
  }

  it('still retries other network errors', async () => {
    const reset = new TypeError('fetch failed', {
      cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
    })
    const { flashpi, sent } = client([reset, new TypeError('fetch failed'), json({})], {
      maxRetries: 2,
    })
    vi.useFakeTimers()
    try {
      const call = flashpi.status.get()
      await vi.runAllTimersAsync()
      await call
    } finally {
      vi.useRealTimers()
    }
    expect(sent).toHaveLength(3)
  })
})

describe('header values from JavaScript callers', () => {
  it('checks a value that is not text as the text Headers would send', async () => {
    const { flashpi, sent } = client([])
    const secret = valueWith('\x01')
    const shapes = {
      'an array': ['a', secret],
      'an object with toString': { toString: () => secret },
    }
    for (const value of Object.values(shapes)) {
      const error = await rejectionOf(flashpi.status.get({ headers: { 'x-a': value as never } }))
      expect(error).toBeInstanceOf(TypeError)
      expect((error as TypeError).message).toBe(
        'The value of the "x-a" header in headers has a line break or another control character',
      )
      expectNothingOf(secret, error)
    }
    expect(sent).toHaveLength(0)
  })

  it('turns a value into text once, and sends the text it checked', async () => {
    let calls = 0
    const value = { toString: () => (++calls === 1 ? 'checked' : valueWith('\x01')) }
    const { flashpi, sent } = client([json({})])
    await flashpi.status.get({ headers: { 'x-a': value as never } })
    expect(calls).toBe(1)
    expect(sent[0]?.headers.get('x-a')).toBe('checked')
  })

  it('refuses a symbol with its own TypeError, as Headers does', async () => {
    const { flashpi, sent } = client([])
    await expect(flashpi.status.get({ headers: { 'x-a': Symbol('x') as never } })).rejects.toThrow(
      new TypeError('The value of the "x-a" header in headers is a symbol, not text'),
    )
    expect(sent).toHaveLength(0)
  })

  it('checks headers given as pairs', async () => {
    const { flashpi, sent } = client([])
    const pairs = [['x-a', valueWith('\x01')]]
    await expect(flashpi.status.get({ headers: pairs as never })).rejects.toThrow(TypeError)
    expect(sent).toHaveLength(0)
  })

  it('checks an Idempotency-Key in headers whatever their shape', async () => {
    const { flashpi, sent } = client([json({})])
    const key = valueWith('\x01')
    for (const headers of [new Headers({ 'Idempotency-Key': key }), [['Idempotency-Key', key]]]) {
      const error = await rejectionOf(
        flashpi.invoices.create({} as never, { headers: headers as never }),
      )
      expect(error).toBeInstanceOf(TypeError)
      expectNothingOf(key, error)
    }
    expect(sent).toHaveLength(0)
    // A good one is still honored, as before.
    await flashpi.invoices.create({} as never, {
      headers: new Headers({ 'Idempotency-Key': ' order-42 ' }) as never,
    })
    expect(sent[0]?.headers.get('idempotency-key')).toBe('order-42')
  })
})

describe('header changes while a retry waits', () => {
  it('sends every attempt with the headers checked before the first one', async () => {
    const defaultHeaders: Record<string, string> = { 'x-team': 'billing' }
    const headers: Record<string, string> = { 'x-trace': 'trace-1' }
    const { flashpi, sent } = client(
      [
        () => {
          // The caller changes both objects while the SDK waits to retry.
          defaultHeaders['x-team'] = valueWith('\x01')
          headers['x-trace'] = valueWith('\x7f')
          return problem(503, 'service_unavailable', {}, { 'retry-after': '0' })
        },
        json({}),
      ],
      { defaultHeaders, maxRetries: 1 },
    )
    await flashpi.status.get({ headers })
    expect(sent).toHaveLength(2)
    expect(sent[1]?.headers.get('x-team')).toBe('billing')
    expect(sent[1]?.headers.get('x-trace')).toBe('trace-1')
  })
})

/** Every shape `new Headers()` takes, each holding the same `entries`. */
function shapesOf(entries: [string, string][]): Record<string, () => HeadersLike> {
  return {
    'a Headers instance': () => new Headers(entries),
    'an array of pairs': () => entries.map(([name, value]) => [name, value] as const),
    'a Map': () => new Map(entries),
    'a generator': () =>
      (function* () {
        yield* entries
      })(),
  }
}

type HeadersLike = NonNullable<RequestOptions['headers']>

describe('request headers in every shape Headers takes', () => {
  for (const [shape, headers] of Object.entries(
    shapesOf([
      ['X-Trace', 'trace-1'],
      ['x-team', ' billing\t'],
    ]),
  )) {
    it(`sends ${shape} like a plain object`, async () => {
      const { flashpi, sent } = client([json({})])
      await flashpi.status.get({ headers: headers() })
      expect([...(sent[0]?.headers ?? [])].filter(([name]) => name.startsWith('x-'))).toEqual([
        ['x-team', 'billing'],
        ['x-trace', 'trace-1'],
      ])
    })

    it(`checks every value of ${shape}, without showing it`, async () => {
      const { flashpi, sent } = client([])
      const value = valueWith('\x01')
      const bad = shapesOf([
        ['x-team', 'billing'],
        ['X-Trace', value],
      ])[shape]
      const error = await rejectionOf(flashpi.status.get({ headers: bad?.() }))
      expect(error).toBeInstanceOf(TypeError)
      expect((error as TypeError).message).toMatch(
        /^The value of the "x-trace" header in headers has a line break or another control character$/i,
      )
      expectNothingOf(value, error)
      expect(sent).toHaveLength(0)
    })

    it(`refuses the headers fetch handles itself in ${shape}`, async () => {
      const { flashpi, sent } = client([])
      const refused = shapesOf([['Content-Length', '999']])[shape]
      await expect(
        flashpi.invoices.create({ total: 1 } as never, { headers: refused?.() }),
      ).rejects.toThrow(/^headers cannot carry "content-length": fetch sets it from the body$/i)
      expect(sent).toHaveLength(0)
    })
  }

  it('joins a name given twice in pairs with ", ", as Headers does', async () => {
    const { flashpi, sent } = client([json({})], { defaultHeaders: { 'x-tag': 'default' } })
    await flashpi.status.get({
      headers: [
        ['X-Tag', 'a'],
        ['x-tag', ' b '],
      ],
    })
    // The request's pairs replace the client's value for that name, as a plain object does.
    expect(sent[0]?.headers.get('x-tag')).toBe('a, b')
    expect(sent[0]?.headers.has('0')).toBe(false)
  })

  it('refuses an entry that is not a [name, value] pair, without showing it', async () => {
    const { flashpi, sent } = client([])
    const value = valueWith('-')
    for (const entry of [['x-a', value, 'more'], ['x-a'], value, { 0: 'x-a', 1: value }]) {
      const error = await rejectionOf(
        flashpi.status.get({ headers: [entry] as unknown as HeadersLike }),
      )
      expect(error).toBeInstanceOf(TypeError)
      expect((error as TypeError).message).toBe(
        'headers has an entry that is not a [name, value] pair',
      )
      expectNothingOf(value, error)
    }
    await expect(
      flashpi.status.get({ headers: [[Symbol('x-a'), 'value']] as unknown as HeadersLike }),
    ).rejects.toThrow(new TypeError('headers has a header name that is a symbol'))
    expect(sent).toHaveLength(0)
  })

  it('refuses headers that are not an object, a Headers instance or pairs', async () => {
    const { flashpi, sent } = client([json({})])
    for (const headers of ['x-a: 1', 42, true]) {
      await expect(
        flashpi.status.get({ headers: headers as unknown as HeadersLike }),
      ).rejects.toThrow(
        new TypeError('headers must be an object, a Headers instance or [name, value] pairs'),
      )
    }
    expect(sent).toHaveLength(0)
    // null is still no headers, as it always was.
    await flashpi.status.get({ headers: null as unknown as HeadersLike })
    expect(sent).toHaveLength(1)
  })

  it('sends every attempt with the headers read before the first one', async () => {
    const instance = new Headers({ 'x-trace': 'trace-1' })
    const pairs: [string, string][] = [['x-span', 'span-1']]
    const call = (headers: HeadersLike, change: () => void) => {
      const { flashpi, sent } = client(
        [
          () => {
            // The caller changes the headers while the SDK waits to retry.
            change()
            return problem(503, 'service_unavailable', {}, { 'retry-after': '0' })
          },
          json({}),
        ],
        { maxRetries: 1 },
      )
      return { done: flashpi.status.get({ headers }), sent }
    }
    const first = call(instance, () => {
      instance.set('x-trace', valueWith('\x01'))
      instance.set('x-added', 'later')
    })
    await first.done
    expect(first.sent[1]?.headers.get('x-trace')).toBe('trace-1')
    expect(first.sent[1]?.headers.has('x-added')).toBe(false)
    const second = call(pairs, () => {
      pairs.push(['x-added', 'later'])
    })
    await second.done
    expect(second.sent[1]?.headers.get('x-span')).toBe('span-1')
    expect(second.sent[1]?.headers.has('x-added')).toBe(false)
  })

  it('takes the Idempotency-Key of any shape, after the idempotencyKey option', async () => {
    const { flashpi, sent } = client([json({}), json({})])
    const headers = shapesOf([
      ['Idempotency-Key', ' order-42 '],
      ['x-trace', 'trace-1'],
    ])
    await flashpi.invoices.create({} as never, { headers: headers['a generator']?.() })
    await flashpi.invoices.create({} as never, {
      headers: headers['a Headers instance']?.(),
      idempotencyKey: 'order-43',
    })
    expect(sent.map((request) => request.headers.get('idempotency-key'))).toEqual([
      'order-42',
      'order-43',
    ])
    expect(sent.map((request) => request.headers.get('x-trace'))).toEqual(['trace-1', 'trace-1'])
  })

  it('layers them like an object: over defaultHeaders and language, never the key', async () => {
    const { flashpi, sent } = client([json({})], {
      defaultHeaders: { 'x-team': 'billing', 'x-keep': 'yes' },
    })
    await flashpi.status.get({
      language: 'en',
      headers: new Headers({
        'X-Team': 'sales',
        'Accept-Language': 'es',
        Authorization: 'Bearer other',
      }),
    })
    const headers = sent[0]?.headers
    expect(headers?.get('x-team')).toBe('sales')
    expect(headers?.get('x-keep')).toBe('yes')
    expect(headers?.get('accept-language')).toBe('es')
    expect(headers?.get('authorization')).toBe(`Bearer ${TEST_KEY}`)
  })

  it('sends them with the read of a document an earlier attempt created', async () => {
    const { flashpi, sent } = client([
      problem(503, 'service_unavailable', {}, { 'retry-after': '0' }),
      problem(422, 'idempotency_key_reused', { documentId: ID }),
      json({ id: ID }),
    ])
    const headers = shapesOf([['x-trace', 'trace-1']])['a generator']?.()
    await flashpi.invoices.create({} as never, { headers })
    expect(sent.map((request) => request.headers.get('x-trace'))).toEqual([
      'trace-1',
      'trace-1',
      'trace-1',
    ])
    expect(sent[2]?.method).toBe('GET')
  })

  it('sends them with every page of a list, even from a generator', async () => {
    const { flashpi, sent } = client([page([{ id: 'a' }], 'c1'), page([{ id: 'b' }])])
    const headers = shapesOf([['x-trace', 'trace-1']])['a generator']?.()
    const ids: string[] = []
    for await (const document of flashpi.documents.list({}, { headers })) ids.push(document.id)
    expect(ids).toEqual(['a', 'b'])
    expect(sent.map((request) => request.headers.get('x-trace'))).toEqual(['trace-1', 'trace-1'])
  })
})
