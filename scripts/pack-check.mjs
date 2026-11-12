#!/usr/bin/env node
// Checks what `npm publish` would ship (run after `pnpm build`): the build files, the
// READMEs, the license and package.json, plus the changelog once release-please writes it.
// Fails on anything missing or anything else.
import { execFileSync } from 'node:child_process'

const required = [
  'dist/index.cjs',
  'dist/index.d.cts',
  'dist/index.d.mts',
  'dist/index.mjs',
  'dist/index.node.d.mts',
  'dist/index.node.mjs',
  'LICENSE',
  'README.en.md',
  'README.md',
  'package.json',
]
const optional = ['CHANGELOG.md']

const [pack] = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }),
)
const files = pack.files.map((file) => file.path).sort()
const missing = required.filter((file) => !files.includes(file))
const extra = files.filter((file) => !required.includes(file) && !optional.includes(file))

if (missing.length > 0 || extra.length > 0) {
  if (missing.length > 0) console.error(`Missing from the package: ${missing.join(', ')}`)
  if (extra.length > 0) console.error(`Unexpected in the package: ${extra.join(', ')}`)
  process.exit(1)
}
console.log(`${pack.name}@${pack.version}: ${files.length} files, ${pack.size} bytes packed`)
