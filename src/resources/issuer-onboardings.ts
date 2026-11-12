import type { APIPromise } from '../core/api-promise'
import { pathOf, type RequestOptions } from '../core/http'
import { APIResource } from '../core/resource'
import type {
  CertificateUpload,
  CompletedIssuerOnboarding,
  CompleteIssuerOnboarding,
  IssuerOnboarding,
} from '../types'
import { certificateForm } from './uploads'

/**
 * Creates an issuer from its .p12: upload the certificate, wait while the onboarding is
 * `verifying` until it is `ready` (Flashpi reads the holder, RUC and SRI data) or `rejected`,
 * review the prefill, then complete it.
 * Needs an account-scoped API key with read_write access.
 */
export class IssuerOnboardings extends APIResource {
  /** Starts an onboarding with a .p12 and its password. It starts `verifying`. */
  create(upload: CertificateUpload, options?: RequestOptions): APIPromise<IssuerOnboarding> {
    return this._call({
      method: 'POST',
      path: '/v1/issuer-onboardings',
      multipart: certificateForm(upload),
      options,
    })
  }

  /** Retrieves an onboarding, to follow it while it is `verifying`. */
  get(onboardingId: string, options?: RequestOptions): APIPromise<IssuerOnboarding> {
    return this._get(pathOf`/v1/issuer-onboardings/${onboardingId}`, options)
  }

  /**
   * Completes a `ready` onboarding.
   *
   * - For a new RUC, `body` is the issuer to create (as in `issuers.create`): `legalName`,
   *   `headOfficeAddress` and `taxProfile` are required. Build it from `onboarding.prefill`;
   *   the API does not apply the prefill by itself.
   * - When `onboarding.existingIssuer` is set, `body` can be `{}`: the certificate is added to
   *   that issuer for both modes (a renewal) and the issuer is left as it is.
   * - Send `ruc` when `onboarding.rucNeedsConfirmation` is true.
   */
  complete(
    onboardingId: string,
    body: CompleteIssuerOnboarding = {},
    options?: RequestOptions,
  ): APIPromise<CompletedIssuerOnboarding> {
    return this._post(pathOf`/v1/issuer-onboardings/${onboardingId}/complete`, body, options)
  }
}
