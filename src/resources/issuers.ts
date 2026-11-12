import type { APIPromise } from '../core/api-promise'
import { pathOf, type RequestOptions } from '../core/http'
import type { PagePromise } from '../core/pagination'
import { APIResource } from '../core/resource'
import type {
  Certificate,
  CertificateListParams,
  CertificateUpload,
  CreateEmissionPoint,
  CreateEstablishment,
  CreateIssuer,
  EmissionPoint,
  EmissionPointListParams,
  Establishment,
  EstablishmentListParams,
  Issuer,
  IssuerListParams,
  UpdateEstablishment,
  UpdateIssuer,
} from '../types'
import { certificateForm } from './uploads'

/**
 * The issuers (RUCs) of the account, with their establishments, emission points and .p12
 * certificates. Needs an account-scoped API key with read_write access, also to read.
 */
export class Issuers extends APIResource {
  /** Establishments of an issuer, with their emission points. */
  readonly establishments: Establishments = new Establishments(this.http)
  /** The .p12 certificates of an issuer. */
  readonly certificates: Certificates = new Certificates(this.http)

  /** Creates an issuer. To start from its .p12 instead, see `issuerOnboardings`. */
  create(body: CreateIssuer, options?: RequestOptions): APIPromise<Issuer> {
    return this._post('/v1/issuers', body, options)
  }

  /** Lists the issuers, newest first. */
  list(params?: IssuerListParams, options?: RequestOptions): PagePromise<Issuer> {
    return this._list('/v1/issuers', params, options)
  }

  /** Retrieves an issuer. */
  get(issuerId: string, options?: RequestOptions): APIPromise<Issuer> {
    return this._get(pathOf`/v1/issuers/${issuerId}`, options)
  }

  /** Updates an issuer's name, tax profile, branding or defaults (only the fields sent). */
  update(issuerId: string, body: UpdateIssuer, options?: RequestOptions): APIPromise<Issuer> {
    return this._patch(pathOf`/v1/issuers/${issuerId}`, body, options)
  }

  /**
   * Deletes an issuer that has no documents and no certificates, with its establishments,
   * emission points and issuer-scoped API keys. Otherwise 409 `resource_in_use`: certificates
   * cannot be deleted, so an issuer that ever had a .p12 (one from `issuerOnboardings` too)
   * stays.
   */
  delete(issuerId: string, options?: RequestOptions): APIPromise<void> {
    return this._delete(pathOf`/v1/issuers/${issuerId}`, options)
  }
}

/** Establishments (the 3-digit series codes such as `001`) of an issuer. */
export class Establishments extends APIResource {
  /** Emission points of an establishment. */
  readonly emissionPoints: EmissionPoints = new EmissionPoints(this.http)

  create(
    issuerId: string,
    body: CreateEstablishment,
    options?: RequestOptions,
  ): APIPromise<Establishment> {
    return this._post(pathOf`/v1/issuers/${issuerId}/establishments`, body, options)
  }

  /** Lists the establishments of an issuer, by code. */
  list(
    issuerId: string,
    params?: EstablishmentListParams,
    options?: RequestOptions,
  ): PagePromise<Establishment> {
    return this._list(pathOf`/v1/issuers/${issuerId}/establishments`, params, options)
  }

  get(
    issuerId: string,
    establishmentId: string,
    options?: RequestOptions,
  ): APIPromise<Establishment> {
    return this._get(pathOf`/v1/issuers/${issuerId}/establishments/${establishmentId}`, options)
  }

  update(
    issuerId: string,
    establishmentId: string,
    body: UpdateEstablishment,
    options?: RequestOptions,
  ): APIPromise<Establishment> {
    return this._patch(
      pathOf`/v1/issuers/${issuerId}/establishments/${establishmentId}`,
      body,
      options,
    )
  }

  delete(issuerId: string, establishmentId: string, options?: RequestOptions): APIPromise<void> {
    return this._delete(pathOf`/v1/issuers/${issuerId}/establishments/${establishmentId}`, options)
  }
}

/** Emission points (the second 3-digit series code) of an establishment. */
export class EmissionPoints extends APIResource {
  create(
    issuerId: string,
    establishmentId: string,
    body: CreateEmissionPoint,
    options?: RequestOptions,
  ): APIPromise<EmissionPoint> {
    return this._post(
      pathOf`/v1/issuers/${issuerId}/establishments/${establishmentId}/emission-points`,
      body,
      options,
    )
  }

  /** Lists the emission points of an establishment, by code. */
  list(
    issuerId: string,
    establishmentId: string,
    params?: EmissionPointListParams,
    options?: RequestOptions,
  ): PagePromise<EmissionPoint> {
    return this._list(
      pathOf`/v1/issuers/${issuerId}/establishments/${establishmentId}/emission-points`,
      params,
      options,
    )
  }

  get(
    issuerId: string,
    establishmentId: string,
    emissionPointId: string,
    options?: RequestOptions,
  ): APIPromise<EmissionPoint> {
    return this._get(
      pathOf`/v1/issuers/${issuerId}/establishments/${establishmentId}/emission-points/${emissionPointId}`,
      options,
    )
  }

  delete(
    issuerId: string,
    establishmentId: string,
    emissionPointId: string,
    options?: RequestOptions,
  ): APIPromise<void> {
    return this._delete(
      pathOf`/v1/issuers/${issuerId}/establishments/${establishmentId}/emission-points/${emissionPointId}`,
      options,
    )
  }
}

/** The .p12 certificates (firmas electrónicas) of an issuer. */
export class Certificates extends APIResource {
  /**
   * Uploads a .p12 for the issuer, for the mode of the API key only (test or live). To renew
   * the certificate of both modes, start an `issuerOnboardings` with it instead.
   *
   * Flashpi checks it in the background: the certificate starts `processing`, then becomes
   * `accepted` (event `certificate.verified`, or `certificate.pending` while its revocation
   * status cannot be checked) or `rejected` (no event: follow it with `get()` and read
   * `rejection`).
   */
  upload(
    issuerId: string,
    upload: CertificateUpload,
    options?: RequestOptions,
  ): APIPromise<Certificate> {
    return this._call({
      method: 'POST',
      path: pathOf`/v1/issuers/${issuerId}/certificates`,
      multipart: certificateForm(upload),
      options,
    })
  }

  /** Lists the certificates of an issuer, newest first. */
  list(
    issuerId: string,
    params?: CertificateListParams,
    options?: RequestOptions,
  ): PagePromise<Certificate> {
    return this._list(pathOf`/v1/issuers/${issuerId}/certificates`, params, options)
  }

  get(issuerId: string, certificateId: string, options?: RequestOptions): APIPromise<Certificate> {
    return this._get(pathOf`/v1/issuers/${issuerId}/certificates/${certificateId}`, options)
  }
}
