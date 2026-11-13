# Decisions

Settled decisions about @flashpi/node, newest first. Each one was taken with the Flashpi
product owner.

## 2026-11-13: hardening after the Python SDK's reviews

Two adversarial reviews of the Python SDK (flashpi-python) found five defects that this SDK had
too. The owner approved fixing them here with the rules Python follows; each code fix has a
regression test that fails without it. The checks are plain JavaScript, so they behave the same
on Node.js, Bun, Deno and Workers. The owner then confirmed the header rules as built and asked
for headers in every shape `Headers` takes (the two bullets after _Header values_).

- **API key.** It is still trimmed as `String.prototype.trim()` does, and its prefix checked;
  then it must be visible ASCII without spaces (`/^[\x21-\x7e]+$/`). Otherwise the client is
  not created: a `FlashpiError` says why without showing the key or any part of it, also when
  it comes from `FLASHPI_API_KEY`. Before, a key with a line break or a NUL made every request
  fail with a `TypeError` from `Headers` whose message quoted `Bearer <key>`, and inner spaces
  were sent.
- **Header values.** Every value the SDK turns into a header (`idempotencyKey`, `correlationId`,
  `language`, `headers`, and the client's `defaultHeaders` and `language`) is checked before
  anything is sent, after trimming the spaces, tabs and line breaks around it as `Headers` does.
  A control character other than a tab left inside throws a `TypeError` that names the header or
  option, never the value, and is not retried; the client's settings fail when the client is
  created (and `defaultHeaders` again before each request, in case the object changed). Every
  attempt of a request is built from the copies checked before the first one, so a value the
  caller changes while a retry waits is not sent. A value that is not text (from JavaScript) is
  turned into text once, as `Headers` would, and that text is checked and sent; a symbol is
  refused. `headers` and `defaultHeaders` are read in every shape `Headers` takes (see
  _Headers in every shape_). Trimming takes linear time (a first version used a regular
  expression that took seconds on a long run of inner spaces). Before, `\x01`, `\x0b`, `\x7f`
  and the like passed `Headers`; Node.js's fetch then refused them while sending ("fetch
  failed"), which the SDK retried as a `ConnectionError`, and Bun and Workers sent them.
  `Content-Length` and `Transfer-Encoding` in `headers` or `defaultHeaders` throw a `TypeError`
  too: fetch sets them from the body, and a wrong one failed (or hung until the timeout) only
  while sending, as a retried network error. So do `Keep-Alive`, `Upgrade` and `Expect`:
  Node.js's fetch refused them while sending, as a retried network error too, Bun hangs on
  `Upgrade` and Workers on `Expect` (`Connection` is still passed to fetch: only Node.js 22
  refuses some values, the case below). And when Node.js's fetch refuses a request as invalid
  before sending it (undici's `UND_ERR_INVALID_ARG` or `UND_ERR_NOT_SUPPORTED`, such as
  `Connection: upgrade` on Node.js 22), the SDK throws a `FlashpiError` that is not retried, as
  Python does when httpx refuses one, with undici's reason, which names the header and never its
  value. What `Headers` refused at once is still refused at once with a `TypeError`, but the SDK
  asks `Headers` first and throws its own error, which never shows the value (Bun's quotes it):
  characters above U+00FF are still refused on Node.js and Bun and sent as UTF-8 on Workers, and
  Latin-1 values (0x80 to 0xFF) are still sent. A lone surrogate is refused on every runtime, as
  in Python: Workers sent it as ill-formed UTF-8. As in Python, the trimmed Idempotency-Key, the
  one sent, is the one on errors, and a request `language` of spaces only keeps the client's.
- **Confirmed by the owner** (2026-11-13, final), as built above: `Keep-Alive`, `Upgrade` and
  `Expect` are refused with a `TypeError` on every runtime, besides `Content-Length` and
  `Transfer-Encoding`; a request Node.js's fetch refuses as invalid (`UND_ERR_INVALID_ARG`,
  `UND_ERR_NOT_SUPPORTED`) is a `FlashpiError` that is not retried, with undici's reason and
  `cause`; a lone surrogate in a header value is refused; and header errors never show the value
  (the SDK's own `TypeError` instead of the runtime's). The owner also accepted these choices of
  the fix: a CR, LF or NUL gets the SDK's `TypeError`, which names only the header;
  `error.idempotencyKey` is the trimmed key that was sent; a request `language` of spaces only
  keeps the client's; and `idempotencyKey` is checked on every method, also those that do not
  send it.
- **Headers in every shape** (owner's request, 2026-11-13). `headers` given as a `Headers`
  instance, a `Map` or a generator were dropped but for their `Idempotency-Key`, pairs in an
  array became headers named `0`, `1`, ... (`0: x-a,1`), and an `Idempotency-Key` in a `Headers`
  instance in `defaultHeaders` was not refused. Now a request's `headers` and the client's
  `defaultHeaders` take every shape `new Headers()` takes: a plain object, a `Headers` instance,
  or `[name, value]` pairs (an array, a `Map`, any iterable). Every shape gets the checks of a
  plain object: trimming, control characters and lone surrogates, the names fetch handles itself,
  errors that never show the value, and the `Idempotency-Key` rules (`idempotencyKey` still wins
  over the header, and the header is still refused in `defaultHeaders`). They are read once into
  a checked copy that every attempt, and the read of a recovered document, use, so a later change
  is never sent. As in `Headers`, a name given twice in pairs gets both values, joined with ", "; a
  plain object keeps the last of two names that differ only in case, as before. A request's
  `headers` still replace the client's values of the names they carry. `defaultHeaders` is still
  read again before each request, except an iterator (a generator, `map.entries()`), which can be
  read only once: the client keeps the copy it read when it was created. Likewise, every page of
  a list sends the `headers` the first page read from an iterator. `headers` that are not an
  object (a string became headers named `0`, `1`, ...) and an entry that is not a pair throw a
  `TypeError` that never shows them; `null` is still no headers. The type is a plain object,
  `Headers`, `Iterable<readonly [string, string]>`, or whatever `new Headers()` takes in the
  consumer's own types (the DOM library, @types/node, Bun's or Workers' types), so a value typed
  as `HeadersInit` compiles with and without the DOM library and with
  `exactOptionalPropertyTypes` (`test/types/consumer.ts` is compiled both ways). It is exported
  as `HeadersLike`, so a consumer's declarations that infer it from these options name it: when
  it was not, they spelled out the runtime's `HeadersInit`, which with only @types/node is
  undici-types' one, and a pnpm project, which cannot reach that package, failed to compile them
  (TS2883, "cannot be named").
- **Publishing.** The Release workflow's publish job held `id-token: write`, which npm's trusted
  publishing turns into a publish token, while it ran `pnpm install`, the typecheck, the tests
  and the build: code of the repository and of every dependency. A build job, with a read-only
  token and no environment, secret or cache, now checks out the tag (by its full ref,
  `refs/tags/<tag>`, since checkout takes a branch over a tag with the same short name, and
  fails unless the tag is still on the commit release-please released: tags are not protected),
  installs with the frozen lockfile, typechecks, tests, builds, runs `pack:check`, packs with
  `npm pack` what `npm publish` would publish, checks the tarball's name against the tag and
  keeps it 30 days as an artifact (the `npm` environment's approval can wait). The publish job,
  in the `npm` environment with `id-token: write` only, checks out and installs nothing: it sets
  up the Node.js of `.nvmrc` (as the build job reports it), checks that npm is 11.5.1 or later
  and runs `npm publish <tarball> --access public --provenance`. The trusted publisher (workflow
  `release.yml`, environment `npm`) does not change. Trusted publishing turns provenance on by
  itself only when npm's lookup of the package's visibility succeeds, and npm 11 publishes
  without it, quietly, when that lookup fails; with `--provenance`, a release without a
  provenance statement fails instead.
- **The contract download.** `pnpm openapi:sync` downloaded `FLASHPI_OPENAPI_URL` whatever its
  scheme, and fetch followed redirects to plain HTTP by itself. `scripts/download.mjs` now
  refuses a URL that is not `https://` and follows redirects by hand, at most five, only to
  `https://` URLs, each refused before it is requested.
- **Organization settings.** `FLASHPI_BOT_CLIENT_ID`, `FLASHPI_BOT_PRIVATE_KEY`,
  `FLASHPI_TEST_API_KEY` and `FLASHPI_DEMO_ISSUER_ID` are organization variables and secrets of
  `flashpi1`, shared with flashpi-python, not repository ones as the docs said. Rotate or change
  them in the organization: a repository copy would shadow them in this repository only.

## 2026-11-13: release PRs run CI by themselves

The 0.1.0 release PR could not merge until its CI run was approved by hand. Since 2026-06-11
GitHub holds the CI of a pull request created or updated with `GITHUB_TOKEN` until someone
with write access approves it, and no setting lifts that. The checks of the `ci.yml` runs the
Release workflow dispatched did not count: required checks only take push and pull_request
runs.

- **A GitHub App** (owner's choice, over approving by hand each time or a personal token): the
  organization's app opens and updates the release PR and the OpenAPI sync PR, so their CI runs
  like on any PR. The token lasts one hour, covers this repository only, carries only the
  permissions each job needs, and is revoked when the job ends.
- **The App's key never meets dependency code.** A job gets every secret it references when it
  starts, and anything a dependency runs can reach the rest of the job. So OpenAPI sync is two
  jobs: one installs, regenerates and checks with no secret and hands the two contract files
  over as an artifact; the other runs no repository or dependency code, copies just those two
  files into a fresh checkout (the artifact is downloaded outside it) and opens the PR with the
  App's token. In Release, the key only reaches the job that runs the two pinned actions that
  create the token and run release-please.
- **No more dispatched CI.** The Release workflow only starts the live API test on the release
  branch. release-please runs with `permissions: {}`; the only write permissions left on
  `GITHUB_TOKEN` are `actions: write` in the live-test job, to start `live.yml`, and
  `id-token: write` in the publish job, for npm's OIDC.
- **Required checks only from GitHub Actions** (owner's choice): the five required checks on
  `main` count only when the GitHub Actions app reports them, so a commit status with the same
  name cannot stand in for CI.

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
  with a copy of the document; a daily workflow syncs them. Hand-written only where the SDK
  adds something: the webhook bodies (`WebhookEvent`, `ThinWebhookEvent`), the open code
  unions (`ApiErrorCode`, `ApiFieldErrorCode`, so a code added later still compiles), list
  filters, `CertificateUpload` and `DocumentXml`.
- **The OpenAPI document's gaps were fixed in the API** (flashpi1/flashpi-api#13, deployed
  2026-11-12, owner's choice to fix them apart): integer `limit`, `waitTimeoutSeconds` 1 to 30,
  the 413, 415, 429 and 503 answers and the headers, `ErrorCode` limited to what `/v1` answers,
  `Event` as a union discriminated by `type`, and the `ProblemDetails` extension members. The
  SDK then dropped its hand-written event and problem types for the generated ones, and widened
  the now enumerated `FieldError.code` to an open union like `ErrorCode`.
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
