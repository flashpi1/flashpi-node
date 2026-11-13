/**
 * Regression tests for the hardening after the Python SDK's reviews (2026-11-13): defects the two
 * reviews of flashpi-python found that the Node.js SDK had too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Flashpi, FlashpiError } from '../src'
import { TEST_KEY, json, mockFetch } from './support'

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
