/**
 * What went wrong:
 * - `missing_api_key`: no API key was passed and `BFL_API_KEY` is not set.
 * - `invalid_api_key`: the API rejected the key.
 * - `invalid_request`: the API rejected the input, or the `model` is unknown.
 * - `insufficient_credits`: the account has no credits left. Add credits, then start again.
 * - `rate_limited`: too many requests, or too many running jobs. Try again later.
 * - `server_error`: the API had an internal error. Try again later.
 * - `network_error`: the API could not be reached.
 * - `timeout`: the API did not answer in time (see `timeoutMs`).
 * - `unknown_error`: the API sent a reply the SDK does not understand.
 * - `invalid_job`: the job can't be checked: its `pollingUrl` is not a BFL host.
 * - `job_not_found`: no such job: the id is wrong, or the finished job was already deleted.
 */
export type BflErrorCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'invalid_request'
  | 'insufficient_credits'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'timeout'
  | 'unknown_error'
  | 'invalid_job'
  | 'job_not_found'

// Recognizes errors from any copy of the SDK.
const MARK = Symbol.for('@bfl/sdk/error')

const TRANSIENT = new Set<BflErrorCode>([
  'rate_limited',
  'server_error',
  'network_error',
  'timeout',
])

/** An error from the SDK or the BFL API. `code` tells what went wrong. */
export class BflError extends Error {
  declare readonly name: 'BflError'
  /** What went wrong. */
  readonly code: BflErrorCode

  constructor(code: BflErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BflError'
    this.code = code
    Object.defineProperty(this, MARK, { value: true })
  }

  /** `true` when the error is temporary: calling again later may work. */
  get retryable(): boolean {
    return TRANSIENT.has(this.code)
  }

  /**
   * `true` when `value` is a `BflError`. Unlike `instanceof`, it also works when the app has
   * several copies of the SDK installed.
   */
  static isInstance(value: unknown): value is BflError {
    return typeof value === 'object' && value !== null && MARK in value
  }
}
