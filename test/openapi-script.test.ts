/**
 * `pnpm openapi:sync` goes through scripts/download.mjs: it refuses an http://
 * FLASHPI_OPENAPI_URL without requesting it (2026-11-13, after the Python SDK's reviews).
 */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { expect, it } from 'vitest'

it('openapi:sync refuses an http:// FLASHPI_OPENAPI_URL without requesting it', async () => {
  let requests = 0
  // Answers 404, so even a regression never writes openapi/openapi.json.
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = execFile(
        process.execPath,
        [path.resolve(import.meta.dirname, '../scripts/openapi.mjs'), 'sync'],
        {
          env: {
            ...process.env,
            FLASHPI_OPENAPI_URL: `http://127.0.0.1:${port}/openapi.json`,
            FLASHPI_OPENAPI_FILE: '',
          },
        },
        (_error, _stdout, stderr) => {
          resolve({ code: child.exitCode, stderr })
        },
      )
    })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Refusing to download from a URL that is not https://')
    expect(requests).toBe(0)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}, 20_000)
