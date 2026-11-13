# Contributing to @flashpi/node

Read [docs/decisions.md](docs/decisions.md) first: it records why the SDK is built the way it
is. Decisions about the product (names, behavior, releases) belong to the Flashpi team: ask
before changing them.

## Setup

Node.js 24 (`.nvmrc`) and pnpm 10 (`packageManager`).

```bash
pnpm install
```

## Checks

Run the same checks as CI before every commit:

```bash
pnpm openapi:check && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:cov && pnpm build && pnpm pack:check && pnpm test:runtimes
```

- `pnpm build` writes `dist/` (ESM and CommonJS with their declarations) and runs publint and
  attw on it.
- `pnpm pack:check` lists what `npm publish` would ship and fails on anything missing or extra.
- `pnpm test:runtimes` loads `dist/` on Node.js (ESM, CommonJS, and both at once sharing one
  copy) and on Cloudflare Workers (workerd through Miniflare). CI also runs it on Bun and Deno:
  `bun test/runtimes/esm.mjs`, `deno run test/runtimes/esm.mjs`.
- `pnpm test:live` calls the real API in test mode. It needs `FLASHPI_TEST_API_KEY` (an
  `fp_test_` key, read_write) and `FLASHPI_DEMO_ISSUER_ID`, and issues one test invoice on the
  demo issuer, which has a daily quota: run it only when needed.

## Code conventions

- English for code, identifiers, comments and commit messages. The READMEs are in Spanish
  (`README.md`) and English (`README.en.md`); keep both in step, and keep
  `test/examples/readme.ts` (type-checked) in step with their examples.
- TypeScript strict, no `any`, no semicolons (Prettier `"semi": false`).
- The SDK has **no runtime dependencies** and uses web APIs only (fetch, Headers, FormData,
  Blob, AbortSignal, Web Crypto, TextEncoder), so it runs on Node.js 22+, Bun, Deno and
  Cloudflare Workers. ESLint forbids `node:` imports and `Buffer` in `src/`.
- Every exported declaration has an explicit type (`isolatedDeclarations` in
  `tsconfig.build.json`). `pnpm typecheck` also compiles `test/types/consumer.ts` the way a
  consumer project would (`tsconfig.consumer.json`: the DOM library instead of @types/node, and
  `exactOptionalPropertyTypes`): optional members of hand-written options are `?: T | undefined`.
- Resource methods mirror the API: `create`, `list`, `get`, `update`, `delete`, then actions
  named after the operation (`sendEmail`, `rotateSecret`, `replay`, ...). Path ids come first,
  then the body or the filters, then `RequestOptions`.

## The API contract

`openapi/openapi.json` is a copy of the public document at
https://flashpi.com.ec/docs/openapi.json and `src/generated/openapi.ts` is generated from it.
Never edit either by hand:

```bash
pnpm openapi:sync      # download the document and regenerate the types
pnpm openapi:generate  # regenerate from the committed copy
```

The `OpenAPI sync` workflow does this every day and opens a pull request when the contract
changes. New operations or fields may need a method or a hand-written type in `src/`.

## Commits and releases

Commit with [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
`docs:`, `test:`, `ci:`, `chore:`). They drive the version and the changelog:
[release-please](https://github.com/googleapis/release-please) keeps a release pull request
open, and merging it tags the version and publishes it to npm from the `Release` workflow, with
npm trusted publishing (OIDC, no token) and provenance.

While the version is 0.x, `feat:` raises the minor version and `fix:` the patch version.

Pull requests opened by GitHub Actions (the release PR and the OpenAPI sync PR) start no
workflow by themselves, so the Release and OpenAPI sync workflows dispatch `ci.yml` (and, for a
release, `live.yml`) on their branch. To run them again by hand:
`gh workflow run ci.yml --ref <branch>`.

The publish job runs in the `npm` environment, which waits for a maintainer's approval in
GitHub before it publishes.

### The first release

npm can only trust a publisher for a package that already exists, so 0.1.0 is published by
hand. When its release PR is merged, reject the publish job's approval, then a member of the
`flashpi` npm organization, with two-factor authentication on, publishes from a clean checkout
of the `v0.1.0` tag (npm asks for the second factor):

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm pack:check
npm publish --access public
```

Right after, in the package's settings on npmjs.com, set **Publishing access** to "Require
two-factor authentication and disallow tokens".

The trusted publisher goes in **just before the next release PR is merged**: npm drops a
configuration that has not published within 48 hours. Add it under the package's settings
(GitHub Actions, organization `flashpi1`, repository `flashpi-node`, workflow `release.yml`,
environment `npm`) and tick **npm publish** in its allowed actions, since new configurations
only allow staged publishing by default. From then on, versions are published by the workflow
only.
