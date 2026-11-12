import { Flashpi, type ClientOptions } from '../src'

/** A request the mocked API received. */
export interface Sent {
  method: string
  url: URL
  headers: Headers
  body: RequestInit['body']
  signal: AbortSignal | null | undefined
}

type Reply = Response | Error | ((request: Sent) => Response | Promise<Response>)

/**
 * A fetch that answers from a queue and records what it received. An Error in the queue is
 * thrown like a network failure; a function answers dynamically.
 */
export function mockFetch(...replies: Reply[]): {
  fetch: (input: string, init: RequestInit) => Promise<Response>
  sent: Sent[]
} {
  const sent: Sent[] = []
  const queue = [...replies]
  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const request: Sent = {
      method: init.method ?? 'GET',
      url: new URL(input),
      headers: new Headers(init.headers),
      body: init.body,
      signal: init.signal,
    }
    sent.push(request)
    const reply = queue.shift()
    if (reply === undefined) throw new Error(`Unexpected request ${request.method} ${input}`)
    if (reply instanceof Error) throw reply
    if (typeof reply === 'function') return reply(request)
    return reply
  }
  return { fetch, sent }
}

/** A JSON answer. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_123', ...headers },
  })
}

/** A Problem Details answer like the API's. */
export function problem(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: `https://flashpi.com.ec/docs/en/errors/${code}`,
      title: 'Problem',
      status,
      detail: `Detail of ${code}`,
      instance: '/v1/test',
      code,
      errors: [],
      requestId: 'req_problem',
      ...extra,
    }),
    {
      status,
      headers: {
        'content-type': 'application/problem+json; charset=utf-8',
        'x-request-id': 'req_problem',
        ...headers,
      },
    },
  )
}

/** A list answer. */
export function page(data: unknown[], nextCursor: string | null = null): Response {
  return json({ data, pagination: { nextCursor, hasMore: nextCursor !== null } })
}

export const TEST_KEY = `fp_test_${'a'.repeat(16)}${'b'.repeat(32)}`
export const LIVE_KEY = `fp_live_${'a'.repeat(16)}${'b'.repeat(32)}`
export const ID = '019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b'
export const OTHER_ID = '019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6a7c'

/** A client on a mocked fetch. */
export function client(
  replies: Reply[],
  options: ClientOptions = {},
): { flashpi: Flashpi; sent: Sent[] } {
  const { fetch, sent } = mockFetch(...replies)
  const flashpi = new Flashpi(TEST_KEY, { fetch, ...options })
  return { flashpi, sent }
}

/** The JSON body a request sent. */
export function sentJson(request: Sent | undefined): unknown {
  if (typeof request?.body !== 'string') throw new Error('The request had no JSON body')
  return JSON.parse(request.body)
}

/** A minimal document as the API returns it (only the fields the tests read). */
export function documentBody(id: string = ID, status = 'processing'): Record<string, unknown> {
  return { id, type: 'invoice', status, environment: 'test', accessKey: '1'.repeat(49) }
}
