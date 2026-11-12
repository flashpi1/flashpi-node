# Decisions

Settled decisions about @flashpi/node, newest first. Each one was taken with the Flashpi
product owner.

## 2026-11-12: after the first review

An adversarial review (five lenses, every finding checked by a second reviewer) confirmed 25
findings; all are fixed, each with a regression test that fails without the fix. The owner
decided three of them:

- **Waiting for an attempt still in progress.** When a retry is answered 409
  `idempotency_key_in_progress`, an earlier attempt of the same call is still running on the API
  (typically a sync issue whose connection dropped). The SDK keeps asking with the same key,
  waiting 1, 2, 4 and then 5 s, until the call's timeout budget (60 s, or the sync wait plus 15 s)
  is spent. These checks do not count as retries. On the first attempt the normal retry rules
  apply, since another process holds the caller's key.
- **One copy for import and require.** Under the `node` export condition, `import` gets
  `dist/index.node.mjs`, a two-line ES module over the CommonJS build, and `require` gets the
  CommonJS build itself. So on Node.js (and Bun, which also matches `node`) an app that loads
  the SDK both ways shares one set of classes, and `instanceof` works. A first version used the
  `module-sync` condition (require() of the ESM build); the second review showed that a
  concurrent `import()` and `require()` then fails for good on Node.js 22 and 24
  (`ERR_REQUIRE_ESM_RACE_CONDITION`), so it was replaced. Other runtimes and bundlers get the
  pure ESM build.
- **Simulated DOMs.** The browser guard only refuses when there is no Node.js, Bun or Deno
  runtime, detected from version values a page element cannot fake (`process.versions.node`,
  `process.versions.bun`, `Deno.version.deno`). So the client can be created in tests with
  jsdom or happy-dom; those tests should pass a mocked `fetch`.
- **Second review.** The in-progress wait only starts when an earlier attempt of the call may
  have reached the API without its answer arriving (a network error, a timeout, or a 5xx without
  Problem Details); once the call's time is spent, the normal retry rules apply. Errors from the
  recovery `GET` keep the POST's key, and the caller's own abort reason is never changed.

Fixed without changing a decision: every `FlashpiError` of a POST carries the `idempotencyKey`
it used (a call cancelled through `signal` rejects with the signal's reason instead); an
`Idempotency-Key` in the request's `headers` is honored (and refused in `defaultHeaders`); the JSON
body is serialized once for all attempts; the request `language` wins over a client
`Accept-Language` header; request `timeout` and `maxRetries` are validated and timeouts are
capped at 2147483647 ms (the `setTimeout` limit); ids `.` and `..` are refused (URL parsing would
send the request to the parent resource); `documents.pdf()` returns `Uint8Array<ArrayBuffer>`, so
`new Response(pdf)` compiles with the DOM library; optional members accept `undefined` under
`exactOptionalPropertyTypes`; Deno without `--allow-env` gets a message that says so; webhooks
compute the HMAC once whatever the number of signatures, validate `tolerance` and `now`
(TypeError), and refuse keys outside 24 to 64 bytes as `invalid_secret`; the READMEs and JSDoc now
match the API on onboarding completion (the prefill is not applied by the API), renewals (an
onboarding, not a per-mode upload), certificate statuses and issuer deletion. `pnpm pack:check`
checks what npm would publish, and `tsconfig.consumer.json` compiles the SDK as a DOM-library
consumer with `exactOptionalPropertyTypes`.

## 2026-11-12: the first SDK

The Node.js/TypeScript SDK is the first of the official SDKs (then Python, PHP with Laravel,
and .NET), and the others follow its design.

- **Package and repository.** `@flashpi/node` on npm, public repository
  `flashpi1/flashpi-node`, MIT license held by SIGNIADIGITAL S.A. First version 0.1.0 (early
  access); 1.0.0 once customers use it.
- **Runtimes.** Node.js 22+, Bun, Deno and Cloudflare Workers, through fetch and Web Crypto,
  with no runtime dependencies. Never browsers: the constructor refuses to run where `window`
  and `document` exist, because the API key is a secret. Deno stays while its runtime is
  supported (it joined Cloudflare in October 2026), with a smoke test in CI.
- **Shape.** Resource style: `new Flashpi(apiKey)`, `flashpi.invoices.create()`,
  `flashpi.documents.list()` (a page that `for await` walks across pages),
  `flashpi.issuers.establishments.create(issuerId, body)`. The key falls back to the
  `FLASHPI_API_KEY` environment variable. Results are `APIPromise`s: await them for the data,
  or call `withResponse()` for the response and request id.
- **Retries.** Every POST carries an Idempotency-Key (generated, or the caller's) that its
  retries reuse. Up to 2 retries with exponential backoff (0.5 s to 8 s, jitter) after network
  errors, timeouts, 408, 429 with a Retry-After of 60 s or less, 5xx except 501 and
  `demo_issuer_unavailable`, and 409 `idempotency_key_in_progress`. Daily quotas (Retry-After
  of hours) are thrown at once. PATCH and DELETE are retried too (idempotent); a DELETE retry
  answered 404 counts as done.
- **Recovering a created document.** When a retry of a document POST (never the first
  attempt) is answered 422 `idempotency_key_reused` with a `documentId`, an earlier attempt of
  the same call created the document, so the SDK returns `GET /v1/documents/{documentId}`
  instead of a false error.
- **Timeouts.** 60 s per attempt by default. With `options.waitForAuthorization`, the attempt
  waits at least `waitTimeoutSeconds` (15 by default) plus 15 s.
- **Errors.** One class per status (`BadRequestError`, `AuthenticationError`,
  `PermissionDeniedError`, `NotFoundError`, `ConflictError`, `UnprocessableEntityError`,
  `RateLimitError`, `InternalServerError`) under `APIError`, with `code`, `errors`,
  `requestId`, `problem` (the whole Problem Details with its extensions) and `retryAfter`.
  `ConnectionError` and `TimeoutError` cover answers that never came. Error codes are an open
  string union: the API may add codes.
- **Language.** English by default, like the API; `language: 'es'` (client or request) sends
  `Accept-Language: es`. Codes do not change.
- **Webhooks.** `unwrapWebhook()` and `verifyWebhookSignature()` (also on `flashpi.webhooks`)
  check the Standard Webhooks signature with Web Crypto, so they are async. Tolerance 5
  minutes. The secret may come with or without `whsec_`. Tested with the vectors of Flashpi's
  docs and of Standard Webhooks; the live API test cannot receive webhooks (no public
  receiver).
- **Types.** Generated with openapi-typescript from the public OpenAPI document
  (https://flashpi.com.ec/docs/openapi.json, since the API repository is private), committed
  with a copy of the document; a daily workflow syncs them. Hand-written where the document
  falls short: events typed by `type` (`DocumentEvent`, `CertificateEvent`, `AccountEvent`,
  the verification event and thin events), `Problem` with extension members, `DocumentXml`.
- **Known gaps in the OpenAPI document**, to fix in flashpi-api later (owner's choice): `limit`
  typed as number instead of integer, `waitTimeoutSeconds` maximum 60 against 30 at runtime,
  undeclared 413, 429 and 503 answers and response headers, console-only codes in `ErrorCode`,
  `Event.data` not discriminated, `ProblemDetails` without extension members.
- **Tooling.** TypeScript 6 (TypeScript 7 breaks openapi-typescript and typescript-eslint),
  tsdown for the dual ESM/CommonJS build with publint and attw, Vitest, release-please
  (Conventional Commits) instead of changesets, and tsdown instead of tsup, which is no longer
  maintained.
- **Publishing.** GitHub Actions with npm trusted publishing (OIDC and provenance) when the
  release pull request is merged. The first version is published by hand because npm cannot
  trust a publisher before the package exists.
- **Tests.** Unit tests on a mocked fetch (with coverage thresholds), the built package on
  Node.js (ESM and CommonJS), Bun, Deno and workerd, and a live suite against the API in test
  mode that issues one invoice on the demo issuer, run on release pull requests only.
- **Security reports.** GitHub private vulnerability reporting.
