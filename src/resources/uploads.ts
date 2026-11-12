import { FlashpiError } from '../core/errors'
import type { CertificateUpload } from '../types'

/** Largest .p12 the API accepts (413 `payload_too_large` above it). */
export const MAX_CERTIFICATE_BYTES = 1_048_576

/**
 * The multipart body of a .p12 upload: one `file` part and one `password` field. The file is
 * read once here, so every retry sends the same bytes (a stream could not be sent twice).
 */
export function certificateForm({ file, password, filename }: CertificateUpload): () => FormData {
  if (typeof password !== 'string') {
    throw new FlashpiError('The certificate password must be a string')
  }
  const blob =
    file instanceof Blob
      ? file
      : new Blob([file instanceof ArrayBuffer ? file : new Uint8Array(file)], {
          type: 'application/x-pkcs12',
        })
  if (blob.size === 0) throw new FlashpiError('The certificate file is empty')
  if (blob.size > MAX_CERTIFICATE_BYTES) {
    throw new FlashpiError(
      `The certificate file has ${blob.size} bytes; the API accepts up to ${MAX_CERTIFICATE_BYTES}`,
    )
  }
  const name = filename ?? 'certificate.p12'
  return () => {
    const form = new FormData()
    form.append('file', blob, name)
    form.append('password', password)
    return form
  }
}
