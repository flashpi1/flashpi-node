/**
 * Type checks of the public types (`pnpm typecheck` compiles this file; the runtime test only
 * confirms it loads).
 */
import { describe, expect, expectTypeOf, it } from 'vitest'

import type {
  AccountEmailSending,
  APIError,
  ApiFieldErrorCode,
  Certificate,
  ClientOptions,
  Document,
  DocumentPayment,
  Event,
  FieldErrorCode,
  HeadersLike,
  Problem,
  RequestOptions,
  ThinEvent,
  WithholdingPayment,
} from '../src'

describe('public types', () => {
  it('keeps field error codes open, like error codes', () => {
    type Code = APIError['errors'][number]['code']
    expectTypeOf<Code>().toEqualTypeOf<ApiFieldErrorCode>()
    expectTypeOf<'a_code_added_later'>().toExtend<Code>()
    expectTypeOf<FieldErrorCode>().toExtend<Code>()
    expect(true).toBe(true)
  })

  it('lets a payment leave out its amount, and knows zero_payment', () => {
    expectTypeOf<DocumentPayment['amount']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<WithholdingPayment['amount']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<{ method: 'cash' }>().toExtend<DocumentPayment>()
    expectTypeOf<{ method: 'cash' }>().toExtend<WithholdingPayment>()
    expectTypeOf<'zero_payment'>().toExtend<FieldErrorCode>()
  })

  it('types the documented problem extension members and allows others', () => {
    expectTypeOf<Problem['documentId']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Problem['limit']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<Problem['somethingNew']>().toEqualTypeOf<unknown>()
  })

  it('narrows an event to its data by type', () => {
    const _narrows = (event: Event): void => {
      if (event.type === 'withholding.rejected') expectTypeOf(event.data).toEqualTypeOf<Document>()
      if (event.type === 'certificate.pending')
        expectTypeOf(event.data).toEqualTypeOf<Certificate>()
      if (event.type === 'account.email_resumed') {
        expectTypeOf(event.data).toEqualTypeOf<AccountEmailSending>()
      }
    }
    expectTypeOf<ThinEvent>().not.toHaveProperty('data')
  })

  it('exports the type of headers and defaultHeaders, so declarations can name it', () => {
    expectTypeOf<RequestOptions['headers']>().toEqualTypeOf<HeadersLike | undefined>()
    expectTypeOf<ClientOptions['defaultHeaders']>().toEqualTypeOf<HeadersLike | undefined>()
  })
})
