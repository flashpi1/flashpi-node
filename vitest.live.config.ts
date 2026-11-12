import { defineConfig, type ViteUserConfig } from 'vitest/config'

// The live suite calls the real Flashpi API in test mode (SRI pruebas) with the fp_test_ key
// in FLASHPI_TEST_API_KEY. It issues real test documents on the shared demo issuer, which has
// a daily quota, so CI runs it only when a release is being prepared.
const config: ViteUserConfig = defineConfig({
  test: {
    include: ['test/live/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})

export default config
