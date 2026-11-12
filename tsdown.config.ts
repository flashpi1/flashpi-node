import { defineConfig, type UserConfig } from 'tsdown'

const config: UserConfig = defineConfig({
  entry: ['src/index.ts'],
  tsconfig: 'tsconfig.build.json',
  // ES modules for import and CommonJS for require, each with its own declarations
  // (.mjs/.d.mts and .cjs/.d.cts).
  format: ['esm', 'cjs'],
  // Web APIs only, so the same build runs on Node.js, Bun, Deno and Cloudflare Workers.
  platform: 'neutral',
  fixedExtension: true,
  target: 'es2022',
  dts: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  publint: true,
  attw: { profile: 'node16', level: 'error' },
})

export default config
