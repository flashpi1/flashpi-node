# Changelog

## [0.2.0](https://github.com/flashpi1/flashpi-node/compare/v0.1.0...v0.2.0) (2026-11-13)


### ⚠ BREAKING CHANGES

* RequestOptions.headers takes every shape Headers takes, so its type is wider than a plain object. Code that reads it as one (options.headers?.['x-a']) must read it with new Headers() instead.

### Features

* accept defaultHeaders in every shape Headers takes ([4c9bd59](https://github.com/flashpi1/flashpi-node/commit/4c9bd5961fe02fbc60a205a7077b25b68cac9774))
* export HeadersLike, the type of headers and defaultHeaders ([ac1e372](https://github.com/flashpi1/flashpi-node/commit/ac1e3722fa13bf8acf2eccc5cb9f59597792104e))
* send request headers given as a Headers instance, pairs or a Map ([afa4cc2](https://github.com/flashpi1/flashpi-node/commit/afa4cc20b07346c90a6f8aeaa14817778ddfb497))


### Bug fixes

* check every header value before sending, and never retry a bad one ([089b00e](https://github.com/flashpi1/flashpi-node/commit/089b00eead7122f5d56cf7faa5e24de1e8a30fec))
* never show a header value Headers refuses, and refuse lone surrogates ([f2cc87d](https://github.com/flashpi1/flashpi-node/commit/f2cc87d8072f6f1f3dac9cfa9493404a5c6f88fb))
* refuse an API key with spaces, line breaks or other characters ([1eb345b](https://github.com/flashpi1/flashpi-node/commit/1eb345b4f62eaeb2c719f26f1b6eef0f7547ae7b))
* refuse Keep-Alive, Upgrade and Expect, and never retry a request fetch refuses ([343d05d](https://github.com/flashpi1/flashpi-node/commit/343d05ddc18d4ed9b5f39b8b37de826fc7f62cf8))
* send every attempt with the header values that were checked ([1670fc0](https://github.com/flashpi1/flashpi-node/commit/1670fc0038a265ada26fa67da3180a41bf970cc5))
* trim header values in linear time ([802da86](https://github.com/flashpi1/flashpi-node/commit/802da863f731d73b9a1628cc82176a34e93ea5eb))

## 0.1.0 (2026-11-13)


### Features

* add the HTTP core with safe retries and typed errors ([267cf32](https://github.com/flashpi1/flashpi-node/commit/267cf3238ae5af277369c44f5a469a1d72819adf))
* cover every operation of the public API ([393f254](https://github.com/flashpi1/flashpi-node/commit/393f254d98d2c7928e56cffc977262c6bb99da7b))
* generate the API types from the public OpenAPI document ([45111df](https://github.com/flashpi1/flashpi-node/commit/45111dfa6392801b9e9dabecef7899549b19c20a))
* load one copy of the SDK with import and require ([fac70b9](https://github.com/flashpi1/flashpi-node/commit/fac70b9f5650fe32e16b74b659c9b43422c8e7c5))
* the Node.js and TypeScript SDK (@flashpi/node 0.1.0) ([5105437](https://github.com/flashpi1/flashpi-node/commit/5105437fa402ab6c98c559a52cac8337cbce4c95))
* **types:** use the API's event and problem types, keep field codes open ([479cda8](https://github.com/flashpi1/flashpi-node/commit/479cda8d8dc947253cdf991d63d4757655a73b9c))
* verify webhook signatures with Web Crypto ([221f3c0](https://github.com/flashpi1/flashpi-node/commit/221f3c02cec5c57e5938ea450ef1efdc9c01e12f))


### Bug fixes

* harden requests, options and webhook checks ([c5956d8](https://github.com/flashpi1/flashpi-node/commit/c5956d8801e6638574cf8180a945d592b09d9b86))
* serve the CommonJS build to both import and require on Node.js ([3392597](https://github.com/flashpi1/flashpi-node/commit/3392597c5bbfd94b940e82159828dea4356f4bcb))
* wait only for this call's own attempt and keep keys on every error ([aede952](https://github.com/flashpi1/flashpi-node/commit/aede9529be3f965588a653ecc26d808d564d11bc))
