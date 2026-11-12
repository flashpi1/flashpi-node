import { describe, expect, it } from 'vitest'

import { Page } from '../src'
import { client, page } from './support'

describe('lists', () => {
  it('awaits to the first page', async () => {
    const { flashpi, sent } = client([page([{ id: 'a' }, { id: 'b' }], 'cursor-1')])
    const first = await flashpi.documents.list({ status: 'authorized', limit: 2 })
    expect(first).toBeInstanceOf(Page)
    expect(first.data).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBe('cursor-1')
    expect(first.hasNextPage()).toBe(true)
    expect(sent[0]?.url.search).toBe('?status=authorized&limit=2')
  })

  it('fetches the next page with the same filters and options', async () => {
    const { flashpi, sent } = client([page([{ id: 'a' }], 'c1'), page([{ id: 'b' }])])
    const first = await flashpi.documents.list({ type: 'invoice' }, { language: 'es' })
    const second = await first.nextPage()
    expect(second?.data).toEqual([{ id: 'b' }])
    expect(second?.hasNextPage()).toBe(false)
    expect(await second?.nextPage()).toBeNull()
    expect(sent[1]?.url.search).toBe('?type=invoice&cursor=c1')
    expect(sent[1]?.headers.get('accept-language')).toBe('es')
  })

  it('iterates every item across pages with for await', async () => {
    const { flashpi, sent } = client([
      page([{ id: 'a' }, { id: 'b' }], 'c1'),
      page([], 'c2'),
      page([{ id: 'c' }]),
    ])
    const ids: string[] = []
    for await (const document of flashpi.documents.list({ limit: 2 })) ids.push(document.id)
    expect(ids).toEqual(['a', 'b', 'c'])
    expect(sent.map((request) => request.url.search)).toEqual([
      '?limit=2',
      '?limit=2&cursor=c1',
      '?limit=2&cursor=c2',
    ])
  })

  it('iterates from an awaited page too', async () => {
    const { flashpi } = client([page([{ id: 'a' }], 'c1'), page([{ id: 'b' }])])
    const first = await flashpi.events.list()
    const ids: string[] = []
    for await (const event of first) ids.push(event.id)
    expect(ids).toEqual(['a', 'b'])
  })

  it('stops when the caller breaks out of the loop', async () => {
    const { flashpi, sent } = client([page([{ id: 'a' }, { id: 'b' }], 'c1')])
    for await (const document of flashpi.documents.list()) {
      expect(document.id).toBe('a')
      break
    }
    expect(sent).toHaveLength(1)
  })

  it('starts from a given cursor', async () => {
    const { flashpi, sent } = client([page([])])
    await flashpi.issuers.list({ cursor: 'from-here', limit: 100 })
    expect(sent[0]?.url.search).toBe('?cursor=from-here&limit=100')
  })

  it('does not follow a page that says hasMore without a cursor', async () => {
    const { flashpi } = client([
      new Response(JSON.stringify({ data: [], pagination: { hasMore: true, nextCursor: null } }), {
        status: 200,
      }),
    ])
    const first = await flashpi.documents.list()
    expect(first.hasNextPage()).toBe(false)
    expect(await first.nextPage()).toBeNull()
  })

  it('exposes the response of the first page', async () => {
    const { flashpi } = client([page([])])
    const { data, requestId } = await flashpi.webhookEndpoints.list().withResponse()
    expect(data.data).toEqual([])
    expect(requestId).toBe('req_123')
  })
})
