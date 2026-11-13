# Changelog

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
