import type { ErrorCode, FieldError, ProblemDetails } from '../generated/openapi'

/**
 * An error code of the Flashpi API (`code` of the Problem Details). New codes can appear
 * before this package knows them, so any string is accepted.
 */
export type ApiErrorCode = ErrorCode | (string & {})

/**
 * The Problem Details body of an API error (RFC 9457) with the extension members some codes
 * add, such as `documentId`, `limit`, `resetsAt`, `rideStatus` or `expectedTotal`.
 */
export type Problem = ProblemDetails & Record<string, unknown>

/**
 * Every error this package throws extends this class, except when a call is cancelled through
 * its `signal`: then it rejects with the signal's own reason.
 */
export class FlashpiError extends Error {
  override readonly name: string = 'FlashpiError'
  /**
   * The Idempotency-Key a failed POST used (the caller's or the one the SDK made). To try the
   * same operation again later without issuing twice, pass it back:
   * `create(body, { idempotencyKey: error.idempotencyKey })`.
   */
  idempotencyKey: string | undefined
}

/**
 * The API answered with an error status. Branch on `code` (stable English slugs such as
 * `validation_failed`), never on `message`, which follows the requested language.
 */
export class APIError extends FlashpiError {
  override readonly name: string = 'APIError'
  /** HTTP status of the answer. */
  readonly status: number
  /** Error code, or `null` when the answer had no Problem Details (for example a 502). */
  readonly code: ApiErrorCode | null
  /** Short summary of the problem type. */
  readonly title: string | null
  /** What went wrong in this request. */
  readonly detail: string | null
  /** Field-level problems of a request body or query (may be empty). */
  readonly errors: FieldError[]
  /** Flashpi's id of the request (`x-request-id`): share it with support. */
  readonly requestId: string | null
  /** The full Problem Details body, with its extension members, when there was one. */
  readonly problem: Problem | null
  /** Response headers. */
  readonly headers: Headers

  constructor(status: number, headers: Headers, problem: Problem | null, bodyText?: string) {
    super(errorMessage(status, problem, bodyText))
    this.status = status
    this.headers = headers
    this.problem = problem
    this.code = problem?.code ?? null
    this.title = problem?.title ?? null
    this.detail = problem?.detail ?? null
    this.errors = Array.isArray(problem?.errors) ? problem.errors : []
    this.requestId = problem?.requestId ?? headers.get('x-request-id')
  }

  /**
   * Seconds the API asked to wait before trying again (`Retry-After`), or `null`. Daily quota
   * errors point at the next midnight in Ecuador, so this can be hours.
   */
  get retryAfter(): number | null {
    return parseRetryAfter(this.headers.get('retry-after'))
  }

  /** Builds the error subclass that matches the status of an answer. */
  static from(status: number, headers: Headers, bodyText: string): APIError {
    const problem = parseProblem(bodyText)
    const ErrorClass = errorClassFor(status)
    return new ErrorClass(status, headers, problem, bodyText)
  }
}

/** 400: the request could not be read (malformed JSON, invalid Idempotency-Key, ...). */
export class BadRequestError extends APIError {
  override readonly name: string = 'BadRequestError'
}

/** 401: the API key is missing, malformed, unknown or revoked. */
export class AuthenticationError extends APIError {
  override readonly name: string = 'AuthenticationError'
}

/** 403: the key may not do this (read-only, another issuer, IP allowlist, suspended account). */
export class PermissionDeniedError extends APIError {
  override readonly name: string = 'PermissionDeniedError'
}

/** 404: the resource does not exist in this mode (test or live) for this account. */
export class NotFoundError extends APIError {
  override readonly name: string = 'NotFoundError'
}

/** 409: the request conflicts with the current state (sequential already used, RIDE not ready, ...). */
export class ConflictError extends APIError {
  override readonly name: string = 'ConflictError'
}

/** 422: the request is well formed but invalid (`validation_failed`, `total_mismatch`, ...). */
export class UnprocessableEntityError extends APIError {
  override readonly name: string = 'UnprocessableEntityError'
}

/** 429: a limit was reached; see `retryAfter` and the `limit` and `resetsAt` members. */
export class RateLimitError extends APIError {
  override readonly name: string = 'RateLimitError'
}

/** 5xx: Flashpi failed to answer. Requests are retried automatically before this is thrown. */
export class InternalServerError extends APIError {
  override readonly name: string = 'InternalServerError'
}

/** The request never got an answer (DNS, TLS, connection reset, ...). */
export class ConnectionError extends FlashpiError {
  override readonly name: string = 'ConnectionError'
}

/** The request took longer than the `timeout` option. */
export class TimeoutError extends ConnectionError {
  override readonly name: string = 'TimeoutError'
}

/** Why a webhook was rejected by `verifySignature()` or `unwrap()`. */
export type WebhookVerificationReason =
  | 'missing_headers'
  | 'invalid_timestamp'
  | 'timestamp_out_of_range'
  | 'no_matching_signature'
  | 'invalid_secret'
  | 'invalid_payload'

/** A webhook did not come from Flashpi, was altered, or is too old: answer 400 and ignore it. */
export class WebhookVerificationError extends FlashpiError {
  override readonly name: string = 'WebhookVerificationError'
  readonly reason: WebhookVerificationReason

  constructor(reason: WebhookVerificationReason, message: string) {
    super(message)
    this.reason = reason
  }
}

type APIErrorClass = new (
  status: number,
  headers: Headers,
  problem: Problem | null,
  bodyText?: string,
) => APIError

function errorClassFor(status: number): APIErrorClass {
  switch (status) {
    case 400:
      return BadRequestError
    case 401:
      return AuthenticationError
    case 403:
      return PermissionDeniedError
    case 404:
      return NotFoundError
    case 409:
      return ConflictError
    case 422:
      return UnprocessableEntityError
    case 429:
      return RateLimitError
    default:
      return status >= 500 ? InternalServerError : APIError
  }
}

function parseProblem(bodyText: string): Problem | null {
  if (!bodyText) return null
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (isRecord(parsed) && typeof parsed.code === 'string') return parsed as Problem
  } catch {
    // Not JSON: an answer from the edge (CDN or firewall), not from the API.
  }
  return null
}

function errorMessage(status: number, problem: Problem | null, bodyText?: string): string {
  if (problem) {
    const detail = typeof problem.detail === 'string' ? problem.detail : problem.title
    return `${status} ${problem.code}: ${detail}`
  }
  const excerpt = bodyText?.trim().replace(/\s+/g, ' ').slice(0, 200)
  return excerpt ? `${status} ${excerpt}` : `${status} (no response body)`
}

/** Seconds from a `Retry-After` value (delta-seconds or an HTTP date), or `null`. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.ceil((date - now) / 1000))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
