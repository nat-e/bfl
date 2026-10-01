import type { TracerProvider } from '@opentelemetry/api'
import { BflError } from './errors.js'
import { HttpClient } from './http.js'
import { Videos } from './resources/videos.js'
import { VideoTelemetry } from './telemetry/videos.js'

/** Options for {@link Bfl}. */
export type BflOptions = {
  /** Your BFL API key. Default: the `BFL_API_KEY` environment variable. */
  apiKey?: string

  /** Send new jobs to the EU or US host. Default: `api.bfl.ai`. */
  region?: 'eu' | 'us'

  /** The `fetch` used for every request. Default: the global `fetch`. */
  fetch?: typeof fetch

  /**
   * Each job gets a span, written through the app's OpenTelemetry setup.
   * Without one, nothing is recorded.
   */
  telemetry?: {
    /** Also record the prompt and the video URL on spans. Default: `false`. */
    recordContent?: boolean

    /**
     * Write spans through this provider instead of the global one, e.g. when the runtime
     * registers its own global provider first (Supabase Edge, Deno with `OTEL_DENO`).
     * Default: the global provider.
     */
    tracerProvider?: TracerProvider
  }
}

const HOSTS = {
  default: 'https://api.bfl.ai',
  eu: 'https://api.eu.bfl.ai',
  us: 'https://api.us.bfl.ai',
}

/**
 * Client for the Black Forest Labs API.
 *
 * @example
 * ```ts
 * const bfl = new Bfl() // reads BFL_API_KEY
 * const started = await bfl.videos.fromText({ model: 'flux3', prompt: 'A cat surfing a wave' })
 * // Save the job as JSON. Later, from any process:
 * const job = await bfl.videos.check(started)
 * if (job.status === 'ready') console.log(job.media.url)
 * ```
 */
export class Bfl {
  /** Generate videos. */
  readonly videos: Videos

  /**
   * @throws {@link BflError} `missing_api_key` when no API key is passed and `BFL_API_KEY` is not set.
   */
  constructor(opts: BflOptions = {}) {
    const apiKey = opts.apiKey ?? envApiKey()
    if (!apiKey) {
      throw new BflError('missing_api_key', 'No BFL API key. Pass apiKey or set BFL_API_KEY.')
    }
    const host = HOSTS[opts.region ?? 'default']
    const http = new HttpClient({ apiKey, host, fetch: opts.fetch ?? globalThis.fetch })
    const telemetry = {
      recordContent: opts.telemetry?.recordContent ?? false,
      tracerProvider: opts.telemetry?.tracerProvider,
      serverAddress: new URL(host).hostname,
    }
    this.videos = new Videos(http)
    this.videos.registerHooks(new VideoTelemetry(telemetry))
  }
}

function envApiKey(): string | undefined {
  const { process } = globalThis as { process?: { env: Record<string, string | undefined> } }
  try {
    return process?.env.BFL_API_KEY
  } catch (cause) {
    // Deno throws here when env access isn't allowed.
    const message =
      'Deno denied access to BFL_API_KEY. Pass apiKey, or allow env access (--allow-env).'
    throw new BflError('missing_api_key', message, { cause })
  }
}
