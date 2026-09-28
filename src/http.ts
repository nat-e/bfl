import { BflError } from './errors.js'
import { VERSION } from './version.js'

// First `name/version` token of the runtime's user agent, e.g. `Node.js/24` or `Deno/2.1.4`.
const RUNTIME = /^[^\s/]+\/[^\s/]+/.exec(globalThis.navigator?.userAgent ?? '')?.[0]
const USER_AGENT = `bfl-sdk-js/${VERSION} ${RUNTIME ?? ''}`.trim()

const TIMEOUT_MS = 30_000
const MAX_TIMER_MS = 2 ** 31 - 1 // ~24.8 days, the longest delay setTimeout accepts

/** Options for one call. */
export type HttpRequestOptions = {
  /** How long to wait for the API, in ms. Default: 30 000 (30 s). `Infinity` means no timeout. */
  timeoutMs?: number

  /**
   * Cancels the call. The call then throws the signal's reason (an `AbortError` by default),
   * not a `BflError`.
   */
  signal?: AbortSignal
}

export class HttpClient {
  readonly #host: string
  readonly #apiKey: string
  readonly #fetch: typeof fetch

  constructor(config: { apiKey: string; host: string; fetch: typeof fetch }) {
    this.#host = config.host
    this.#apiKey = config.apiKey
    // Call fetch without `this`: Cloudflare Workers throw "Illegal invocation"
    // when fetch gets another object (here the HttpClient) as `this`.
    const fetchFn = config.fetch
    this.#fetch = (input, init) => fetchFn(input, init)
  }

  /**
   * Allow get queries to a custom URL for polling.
   * This will make sure the URL is safe to prevent sending the API key to untrusted hosts.
   */
  async getCustomUrl<Res>(url: string, options?: HttpRequestOptions): Promise<Res> {
    if (!this.#trusted(url)) {
      throw new BflError(
        'invalid_job',
        `Won't send the API key to ${url}: pollingUrl must be a BFL host.`,
      )
    }
    return this.request('GET', url, undefined, options)
  }

  async post<Res>(
    path: string,
    body?: Record<string, unknown>,
    options?: HttpRequestOptions,
  ): Promise<Res> {
    const url = `${this.#host}${path}`
    return this.request('POST', url, body, options)
  }

  async request<Res>(
    method: RequestInit['method'],
    url: string,
    body?: Record<string, unknown>,
    options?: HttpRequestOptions,
  ): Promise<Res> {
    const headers: Record<string, string> = {
      'x-key': this.#apiKey,
      accept: 'application/json',
      'user-agent': USER_AGENT,
    }
    if (body) {
      headers['content-type'] = 'application/json'
    }
    const timeoutController = new AbortController()
    const timeoutMs = Math.min(options?.timeoutMs ?? TIMEOUT_MS, MAX_TIMER_MS)
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

    let response: Response
    let text: string
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any(
          options?.signal ? [options.signal, timeoutController.signal] : [timeoutController.signal],
        ),
      })
      // Read the body here too, so the timeout and the error handling below cover it.
      text = await response.text()
    } catch (cause) {
      // Throw an AbortError if the user aborted the call
      options?.signal?.throwIfAborted()

      if (timeoutController.signal.aborted) {
        throw new BflError(
          'timeout',
          `The request did not respond in the allotted time. Try again later.`,
        )
      }
      // INFO: Useful error messages indicating next steps, important for AI agents
      throw new BflError(
        'network_error',
        `Could not reach ${new URL(url).origin}. Make sure this is a valid BFL API or check the status page at https://status.bfl.ml`,
        {
          cause,
        },
      )
    } finally {
      clearTimeout(timer)
    }
    return this.#handleResponse(response, text)
  }

  // fetch follows redirects and keeps `x-key` on them, so a redirect from a BFL host is
  // trusted too.
  #trusted(pollingUrl: string): boolean {
    if (!URL.canParse(pollingUrl)) {
      return false
    }
    const { protocol, hostname } = new URL(pollingUrl)
    return protocol === 'https:' && (hostname === 'bfl.ai' || hostname.endsWith('.bfl.ai'))
  }

  #handleResponse<Res>(response: Response, body: string): Res {
    if (response.ok) {
      try {
        return JSON.parse(body)
      } catch {
        throw new BflError('unknown_error', `The returned response was not valid JSON.`)
      }
    }

    const { status } = response
    const errorMessage = parseErrorResponse(body)
    if (status >= 500) {
      throw new BflError(
        'server_error',
        `BFL API Internal error. Check the status page at https://status.bfl.ml`,
      )
    }
    if (status === 403) {
      // Bfl constructor throws on missing API keys, so it must be invalid
      throw new BflError('invalid_api_key', 'The provided API key was invalid')
    }
    // INFO: Not a fan of this. Relying on error messages is brittle and can break.
    // This should be fixed in the API by returning 403 as well (or at least return an error code)
    if (status === 422 && errorMessage === 'Invalid API key format') {
      throw new BflError('invalid_api_key', 'The provided API key was malformed')
    }
    // Only status checks can get a 404: the API answers `Task not found` for unknown or
    // deleted jobs.
    if (status === 404) {
      throw new BflError(
        'job_not_found',
        'BFL has no such job: the id is wrong, or BFL already deleted the finished job (it keeps them for a few hours). Save the job as failed.',
      )
    }
    if (status === 402) {
      throw new BflError('insufficient_credits', `${errorMessage}. Add credits, then start again.`)
    }
    if (status === 429) {
      throw new BflError('rate_limited', `${errorMessage}. Try again later.`)
    }
    if (status === 422) {
      throw new BflError('invalid_request', `The request was invalid: ${errorMessage}.`)
    }
    throw new BflError('unknown_error', `${errorMessage}`)
  }
}

/**
 * Parses a JSON error body from an API response
 **/
function parseErrorResponse(body: string): string | undefined {
  // {'detail': [{'type': 'greater_than_equal', 'loc': ['body', 't2v', 'duration'], 'msg': "Input should be greater than or equal to 5, or 'auto'", 'input': -4, 'ctx': {'ge': 5}}]}

  let detail: unknown
  try {
    detail = (JSON.parse(body) as { detail?: unknown }).detail
  } catch {
    return undefined
  }
  if (typeof detail === 'string') {
    return detail
  }
  if (!Array.isArray(detail)) {
    return undefined
  }
  return (detail as { loc: (string | number)[]; msg: string }[])
    .map(({ loc, msg }) => {
      const path = (loc[0] === 'body' ? loc.slice(1) : loc).join('.')
      return path ? `${path}: ${msg}` : msg
    })
    .join('; ')
}
