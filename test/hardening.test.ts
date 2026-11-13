/**
 * Regression tests for the hardening after the Python SDK's reviews (2026-11-13): defects the two
 * reviews of flashpi-python found that the Node.js SDK had too.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { Flashpi, FlashpiError } from '../src'
import { TEST_KEY, client, json, mockFetch, problem } from './support'

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

  it('leaves characters above U+00FF to Headers, which refuses them at once', async () => {
    const { flashpi, sent } = client([])
    const euro = String.fromCharCode(0x20ac)
    await expect(flashpi.status.get({ headers: { 'x-a': `10 ${euro}` } })).rejects.toThrow(
      TypeError,
    )
    expect(sent).toHaveLength(0)
  })
})

describe('Content-Length and Transfer-Encoding', () => {
  for (const name of [
    'Content-Length',
    'content-length',
    'Transfer-Encoding',
    'TRANSFER-ENCODING',
  ]) {
    it(`refuses ${name} in headers and in defaultHeaders`, async () => {
      const { flashpi, sent } = client([])
      const error = await rejectionOf(
        flashpi.invoices.create({ total: 1 } as never, { headers: { [name]: '999' } }),
      )
      expect(error).toBeInstanceOf(TypeError)
      expect((error as TypeError).message).toBe(
        `headers cannot carry "${name}": fetch sets it from the body`,
      )
      expect(sent).toHaveLength(0)
      expect(() => new Flashpi(TEST_KEY, { defaultHeaders: { [name]: '999' } })).toThrow(
        new TypeError(`defaultHeaders cannot carry "${name}": fetch sets it from the body`),
      )
    })
  }
})
