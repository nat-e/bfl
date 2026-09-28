import { type Mock, vi } from 'vitest'
import {
  Bfl,
  type BflOptions,
  type InProgressJob,
  type VideoFromTextInput,
} from '../../src/index.js'

export const INPUT: VideoFromTextInput = { model: 'flux3', prompt: 'A fox walking in the snow' }
export const POLLING_URL = 'https://api.us1.bfl.ai/v1/get_result?id=job-1'
export const VIDEO_URL = 'https://delivery-us1.bfl.ai/results/job-1/sample.mp4'

export const JOB: InProgressJob<VideoFromTextInput> = {
  id: 'job-1',
  status: 'in_progress',
  pollingUrl: POLLING_URL,
  input: INPUT,
  startedAt: 1_700_000_000_000,
}

// BFL's reply to a new job.
export const SUBMITTED: Record<string, unknown> = {
  id: 'job-1',
  polling_url: POLLING_URL,
  cost: 150,
  input_mp: null,
  output_mp: null,
}

// BFL's reply to a status check.
export function result(fields: Record<string, unknown>): Record<string, unknown> {
  return { id: 'job-1', progress: null, result: null, details: null, ...fields }
}

export const READY: Record<string, unknown> = result({
  status: 'Ready',
  result: { sample: VIDEO_URL, prompt: INPUT.prompt, seed: '1' },
  cost: 150,
})

// BFL's error reply.
export function failure(status: number, detail: unknown): Response {
  return Response.json({ detail }, { status })
}

/**
 * A fetch that answers each call with the next reply: a Response, or a JSON body sent with a 200.
 * The last reply repeats.
 */
export function fakeBfl(...replies: unknown[]): Mock<typeof fetch> {
  let calls = 0
  return vi.fn<typeof fetch>(async () => {
    const reply = replies[Math.min(calls++, replies.length - 1)]
    return reply instanceof Response ? reply.clone() : Response.json(reply)
  })
}

/** A fetch that never answers, and fails like fetch when its signal aborts. */
export const hangingFetch: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })

/** The request the SDK sent on the given call. */
export function sentRequest(
  fetch: Mock<typeof globalThis.fetch>,
  call = 0,
): { url: string; headers: Headers; body: unknown } {
  const [url, init] = fetch.mock.calls[call] ?? []
  return {
    url: String(url),
    headers: new Headers(init?.headers),
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  }
}

export const API_KEY = 'test-key'

export function client(fetch: typeof globalThis.fetch, options?: BflOptions): Bfl {
  return new Bfl({ apiKey: API_KEY, fetch, ...options })
}
