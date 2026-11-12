import { FlashpiError } from './errors'

/** The longest delay `setTimeout` keeps; longer ones fire at once on every runtime. */
export const MAX_TIMEOUT_MS = 2_147_483_647

/** A timeout in milliseconds: more than 0 and at most {@link MAX_TIMEOUT_MS}. */
export function validTimeout(name: string, value: number): number {
  if (typeof value !== 'number' || !(value > 0 && value <= MAX_TIMEOUT_MS)) {
    throw new FlashpiError(`${name} must be between 1 and ${MAX_TIMEOUT_MS} milliseconds`)
  }
  return value
}

/** A number of retries: a whole number, 0 or more. */
export function validRetries(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new FlashpiError(`${name} must be a whole number, 0 or more`)
  }
  return value
}
