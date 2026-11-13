/**
 * scripts/download.mjs, which `pnpm openapi:sync` downloads the API contract with: over HTTPS
 * only, redirects included (2026-11-13, after the Python SDK's reviews).
 */
import { describe, expect, it } from 'vitest'

import { MAX_REDIRECTS, downloadText } from '../scripts/download.mjs'

interface Call {
  url: string
  init: RequestInit
}

/** A fetch that answers from a queue and records what it was asked. */
function fakeFetch(...replies: Response[]): {
  fetch: (input: string, init: RequestInit) => Promise<Response>
  calls: Call[]
} {
  const calls: Call[] = []
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    const reply = replies.shift()
    if (reply === undefined) return Promise.reject(new Error(`Unexpected request to ${url}`))
    return Promise.resolve(reply)
  }
  return { fetch, calls }
}

const redirect = (location: string, status = 302): Response =>
  new Response(null, { status, headers: { location } })

const CONTRACT = '{"openapi":"3.1.0","paths":{}}'

describe('downloadText()', () => {
  it('downloads an https:// URL without letting fetch follow redirects', async () => {
    const { fetch, calls } = fakeFetch(new Response(CONTRACT))
    const text = await downloadText('https://flashpi.com.ec/docs/openapi.json', {
      fetch,
      headers: { accept: 'application/json' },
    })
    expect(text).toBe(CONTRACT)
    expect(calls).toEqual([
      {
        url: 'https://flashpi.com.ec/docs/openapi.json',
        init: { headers: { accept: 'application/json' }, redirect: 'manual' },
      },
    ])
  })

  for (const url of [
    'http://flashpi.com.ec/docs/openapi.json',
    'HTTP://flashpi.com.ec/docs/openapi.json',
    'file:///etc/passwd',
    'ftp://flashpi.com.ec/openapi.json',
    'flashpi.com.ec/docs/openapi.json',
    '',
  ]) {
    it(`refuses ${JSON.stringify(url)} without requesting it`, async () => {
      const { fetch, calls } = fakeFetch(new Response(CONTRACT))
      await expect(downloadText(url, { fetch })).rejects.toThrow(
        /^Refusing to download from a URL that is not https:\/\//,
      )
      expect(calls).toHaveLength(0)
    })
  }

  for (const status of [301, 302, 303, 307, 308]) {
    it(`refuses a ${status} redirect to http:// before requesting it`, async () => {
      const { fetch, calls } = fakeFetch(
        redirect('http://flashpi.com.ec/docs/openapi.json', status),
        new Response('{"tampered":true}'),
      )
      await expect(
        downloadText('https://flashpi.com.ec/docs/openapi.json', { fetch }),
      ).rejects.toThrow(
        'Refusing a redirect to a URL that is not https://: http://flashpi.com.ec/docs/openapi.json',
      )
      expect(calls.map((call) => call.url)).toEqual(['https://flashpi.com.ec/docs/openapi.json'])
    })
  }

  it('refuses a redirect to http:// that comes after an https:// one', async () => {
    const { fetch, calls } = fakeFetch(
      redirect('https://cdn.flashpi.com.ec/openapi.json', 301),
      redirect('http://evil.example/openapi.json', 307),
      new Response('{"tampered":true}'),
    )
    await expect(
      downloadText('https://flashpi.com.ec/docs/openapi.json', { fetch }),
    ).rejects.toThrow(/^Refusing a redirect to a URL that is not https:\/\//)
    expect(calls).toHaveLength(2)
  })

  it('follows https:// redirects, relative ones too, each without fetch following', async () => {
    const { fetch, calls } = fakeFetch(
      redirect('https://cdn.flashpi.com.ec/v2/openapi.json', 301),
      redirect('../v3/openapi.json', 308),
      new Response(CONTRACT),
    )
    const text = await downloadText('https://flashpi.com.ec/docs/openapi.json', { fetch })
    expect(text).toBe(CONTRACT)
    expect(calls.map((call) => call.url)).toEqual([
      'https://flashpi.com.ec/docs/openapi.json',
      'https://cdn.flashpi.com.ec/v2/openapi.json',
      'https://cdn.flashpi.com.ec/v3/openapi.json',
    ])
    expect(calls.every((call) => call.init.redirect === 'manual')).toBe(true)
  })

  it(`stops after ${MAX_REDIRECTS} redirects`, async () => {
    const replies = Array.from({ length: MAX_REDIRECTS + 1 }, (_, hop) =>
      redirect(`https://flashpi.com.ec/hop/${hop + 1}`),
    )
    const { fetch, calls } = fakeFetch(...replies, new Response(CONTRACT))
    await expect(downloadText('https://flashpi.com.ec/hop/0', { fetch })).rejects.toThrow(
      `GET https://flashpi.com.ec/hop/0 redirected more than ${MAX_REDIRECTS} times`,
    )
    expect(calls).toHaveLength(MAX_REDIRECTS + 1)
  })

  it('refuses a redirect without a Location or to an invalid URL', async () => {
    const empty = fakeFetch(new Response(null, { status: 302 }))
    await expect(
      downloadText('https://flashpi.com.ec/docs/openapi.json', { fetch: empty.fetch }),
    ).rejects.toThrow('answered 302 without a Location')
    const invalid = fakeFetch(redirect('https://['))
    await expect(
      downloadText('https://flashpi.com.ec/docs/openapi.json', { fetch: invalid.fetch }),
    ).rejects.toThrow('redirected to an invalid URL')
  })

  it('fails on an error status', async () => {
    const { fetch } = fakeFetch(new Response('Not found', { status: 404 }))
    await expect(
      downloadText('https://flashpi.com.ec/docs/openapi.json', { fetch }),
    ).rejects.toThrow('GET https://flashpi.com.ec/docs/openapi.json answered 404')
  })
})
