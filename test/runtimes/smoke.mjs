// Exercises the BUILT package (dist/) on one runtime: a few API calls on a mocked fetch,
// errors, pagination, the RIDE bytes and a webhook signature. Each runtime entry
// (esm.mjs, cjs.cjs, worker.mjs) passes in the module it loaded.

const KEY = `fp_test_${'a'.repeat(16)}${'b'.repeat(32)}`
const DOC = '019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b'

const WEBHOOK = {
  secret: 'whsec_Zmxhc2hwaS1kb2NzLWV4YW1wbGUtc2VjcmV0LTMyLWI=',
  headers: {
    'webhook-id': '019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b',
    'webhook-timestamp': '1792152000',
    'webhook-signature': 'v1,HbWOpDPWCo3wtq41t9GVHUpg69M1zgvveoDJmSWkA8U=',
  },
  body: '{"id":"019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b","type":"invoice.authorized","environment":"test","createdAt":"2026-10-16T17:20:00.000Z"}',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_smoke' },
  })
}

function check(condition, message) {
  if (!condition) throw new Error(`Smoke check failed: ${message}`)
}

export async function runSmoke(sdk) {
  const { Flashpi, UnprocessableEntityError, unwrapWebhook, VERSION } = sdk
  check(typeof VERSION === 'string', 'VERSION is exported')

  const sent = []
  const replies = [
    json({ id: DOC, type: 'invoice', status: 'authorized' }),
    json({ data: [{ id: 'a' }], pagination: { nextCursor: 'c1', hasMore: true } }),
    json({ data: [{ id: 'b' }], pagination: { nextCursor: null, hasMore: false } }),
    new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      headers: { 'content-type': 'application/pdf' },
    }),
    new Response(
      JSON.stringify({
        type: 'https://flashpi.com.ec/docs/en/errors/validation_failed',
        title: 'Invalid request',
        status: 422,
        detail: 'The request has invalid fields.',
        instance: '/v1/invoices',
        code: 'validation_failed',
        errors: [{ field: 'customer.id', code: 'invalid_check_digit', message: 'Invalid' }],
        requestId: 'req_smoke',
      }),
      { status: 422, headers: { 'content-type': 'application/problem+json' } },
    ),
  ]
  const fetch = async (url, init) => {
    sent.push({ url, init, headers: new Headers(init.headers) })
    const reply = replies.shift()
    if (!reply) throw new Error(`Unexpected request to ${url}`)
    return reply
  }

  const flashpi = new Flashpi(KEY, { fetch, maxRetries: 0 })
  check(flashpi.environment === 'test', 'environment from the key')

  const invoice = await flashpi.invoices.create({ issuerId: DOC })
  check(invoice.status === 'authorized', 'invoices.create returns the document')
  check(sent[0].headers.get('idempotency-key')?.length === 36, 'POST carries an Idempotency-Key')
  check(sent[0].headers.get('authorization') === `Bearer ${KEY}`, 'Bearer key')

  const ids = []
  for await (const document of flashpi.documents.list({ limit: 1 })) ids.push(document.id)
  check(ids.join(',') === 'a,b', `for await walks the pages (got ${ids.join(',')})`)
  check(sent[2].url.endsWith('?limit=1&cursor=c1'), 'the next page keeps the filters')

  const pdf = await flashpi.documents.pdf(DOC)
  check(pdf instanceof Uint8Array && pdf.length === 4 && pdf[0] === 0x25, 'pdf() returns bytes')

  let failure
  try {
    await flashpi.invoices.create({})
  } catch (error) {
    failure = error
  }
  check(failure instanceof UnprocessableEntityError, 'a 422 is an UnprocessableEntityError')
  check(failure.code === 'validation_failed', 'the error carries its code')
  check(failure.errors[0]?.field === 'customer.id', 'the error carries its field errors')

  // Header values are checked before anything is sent, with errors that never show the value
  // (Bun's own Headers error quotes it).
  const secret = 'Zk7QpWMv3RtY'
  const sentBefore = sent.length
  for (const [what, value] of [
    ['a control character', `${secret}\x01`],
    ['a lone surrogate', `${secret}\ud800`],
    ['Keep-Alive', null],
  ]) {
    let error
    try {
      await flashpi.status.get({
        headers: value === null ? { 'Keep-Alive': 'timeout=5' } : { 'x-a': value },
      })
    } catch (caught) {
      error = caught
    }
    check(error instanceof TypeError, `${what} in headers throws a TypeError`)
    check(
      !`${error.message}${error.stack}`.includes(secret),
      `the error of ${what} hides the value`,
    )
  }
  check(sent.length === sentBefore, 'nothing is sent with a bad header')
  // Above U+00FF: Workers sends it as UTF-8; Node.js and Bun refuse it, without showing it.
  replies.push(json({ status: 'operational' }))
  try {
    await flashpi.status.get({ headers: { 'x-a': `${secret}\u20ac` } })
    check(sent.length === sentBefore + 1, 'a header value above U+00FF is sent or refused')
  } catch (error) {
    check(error instanceof TypeError, 'a header value above U+00FF is refused with a TypeError')
    check(!`${error.message}${error.stack}`.includes(secret), 'its error hides the value')
    replies.length = 0
  }

  const event = await unwrapWebhook(
    new TextEncoder().encode(WEBHOOK.body),
    new Headers(WEBHOOK.headers),
    WEBHOOK.secret,
    { now: 1792152000 * 1000 },
  )
  check(event.type === 'invoice.authorized', 'unwrapWebhook verifies and parses')

  let rejected = false
  try {
    await unwrapWebhook(WEBHOOK.body.replace('test', 'live'), WEBHOOK.headers, WEBHOOK.secret, {
      now: 1792152000 * 1000,
    })
  } catch (error) {
    rejected = error.reason === 'no_matching_signature'
  }
  check(rejected, 'an altered webhook is rejected')

  return 'ok'
}
