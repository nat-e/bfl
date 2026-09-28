import { afterEach, describe, expect, test, vi } from 'vitest'
import type { FailedJob, ReadyJob, VideoFromTextInput } from '../../src/index.js'
import {
  client,
  failure,
  fakeBfl,
  INPUT,
  JOB,
  READY,
  result,
  SUBMITTED,
  sentRequest,
  VIDEO_URL,
} from './fake-bfl.js'

const READY_JOB: ReadyJob<VideoFromTextInput> = {
  id: JOB.id,
  input: JOB.input,
  startedAt: JOB.startedAt,
  status: 'ready',
  media: { url: VIDEO_URL, mimeType: 'video/mp4' },
}

const FAILED_JOB: FailedJob<VideoFromTextInput> = {
  id: JOB.id,
  input: JOB.input,
  startedAt: JOB.startedAt,
  status: 'failed',
  error: { type: 'error' },
}

describe('videos.fromText', () => {
  test("returns an in_progress job with BFL's id, pollingUrl and cost", async () => {
    const job = await client(fakeBfl(SUBMITTED)).videos.fromText(INPUT)
    expect(job).toMatchObject({
      id: SUBMITTED.id,
      status: 'in_progress',
      pollingUrl: SUBMITTED.polling_url,
      cost: SUBMITTED.cost,
      input: INPUT,
    })
  })

  test("sends the prompt and settings under BFL's field names", async () => {
    const fetch = fakeBfl(SUBMITTED)
    await client(fetch).videos.fromText({
      ...INPUT,
      duration: 10,
      resolution: 'fhd',
      aspectRatio: '16:9',
      audio: false,
      user: 'user-42',
      version: 'v1',
    })
    expect(sentRequest(fetch).body).toEqual({
      mode: 't2v',
      prompt: INPUT.prompt,
      duration: 10,
      resolution: 'fhd',
      aspect_ratio: '16:9',
      generate_audio: false,
      user: 'user-42',
      version: 'v1',
    })
  })

  test("leaves unset settings out of the request so BFL's defaults apply", async () => {
    const fetch = fakeBfl(SUBMITTED)
    await client(fetch).videos.fromText(INPUT)
    expect(sentRequest(fetch).body).toEqual({ mode: 't2v', prompt: INPUT.prompt })
  })

  test('adds extra fields to the request', async () => {
    const fetch = fakeBfl(SUBMITTED)
    await client(fetch).videos.fromText({ ...INPUT, extra: { seed: 42 } })
    expect(sentRequest(fetch).body).toMatchObject({ seed: 42 })
  })

  test('throws invalid_request for an unknown model without calling BFL', async () => {
    const fetch = fakeBfl(SUBMITTED)
    // @ts-expect-error: JavaScript callers can pass any model
    const started = client(fetch).videos.fromText({ ...INPUT, model: 'flux-unknown' })
    await expect(started).rejects.toMatchObject({ code: 'invalid_request' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('videos.check', () => {
  test('returns a ready job with the video URL and cost when BFL says Ready', async () => {
    const job = await client(fakeBfl(READY)).videos.check(JOB)
    expect(job).toMatchObject({ status: 'ready', media: { url: VIDEO_URL }, cost: 150 })
  })

  test("returns a failed job with BFL's message when BFL says Error", async () => {
    const reply = result({ status: 'Error', details: { error: 'Generation failed' } })
    const job = await client(fakeBfl(reply)).videos.check(JOB)
    expect(job).toMatchObject({
      status: 'failed',
      error: { type: 'error', message: 'Generation failed' },
    })
  })

  test.each([
    { blocked: 'request', status: 'Request Moderated', type: 'request_moderated' },
    { blocked: 'video', status: 'Content Moderated', type: 'content_moderated' },
  ])(
    'returns a failed job with the reasons when BFL blocks the $blocked',
    async ({ status, type }) => {
      const reply = result({ status, details: { 'Moderation Reasons': ['Violence', 'Self Harm'] } })
      const job = await client(fakeBfl(reply)).videos.check(JOB)
      expect(job).toMatchObject({
        status: 'failed',
        error: { type, reasons: ['Violence', 'Self Harm'] },
      })
    },
  )

  test("returns an in_progress job with BFL's status and progress while the video is generating", async () => {
    const job = await client(fakeBfl(result({ status: 'Generating', progress: 0.4 }))).videos.check(
      JOB,
    )
    expect(job).toMatchObject({
      status: 'in_progress',
      processingStatus: 'Generating',
      progress: 0.4,
      pollingUrl: JOB.pollingUrl,
    })
  })

  test.each([
    { status: 'ready', reply: { ...READY, cost: undefined } },
    { status: 'failed', reply: result({ status: 'Error' }) },
  ])(
    'keeps the last known cost when BFL says the job is $status without a cost',
    async ({ status, reply }) => {
      const job = await client(fakeBfl(reply)).videos.check({ ...JOB, cost: 150 })
      expect(job).toMatchObject({ status, cost: 150 })
    },
  )

  test.each([READY_JOB, FAILED_JOB])(
    'returns a $status job unchanged without calling BFL',
    async (job) => {
      const fetch = fakeBfl(READY)
      expect(await client(fetch).videos.check(job)).toEqual(job)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  test('does not change the job passed in', async () => {
    const job = structuredClone(JOB)
    await client(fakeBfl(READY)).videos.check(job)
    expect(job).toEqual(JOB)
  })

  test('checks a job restored with JSON.parse(JSON.stringify(job))', async () => {
    const started = await client(fakeBfl(SUBMITTED)).videos.fromText(INPUT)
    const saved = JSON.stringify(started)
    const job = await client(fakeBfl(READY)).videos.check(JSON.parse(saved))
    expect(job).toMatchObject({ id: started.id, status: 'ready', input: INPUT })
  })

  test("polls the job's pollingUrl even when it is on another region than the client", async () => {
    const pollingUrl = 'https://api.eu1.bfl.ai/v1/get_result?id=job-1'
    const fetch = fakeBfl(READY)
    await client(fetch, { region: 'us' }).videos.check({ ...JOB, pollingUrl })
    expect(sentRequest(fetch).url).toBe(pollingUrl)
  })
})

describe('videos.wait', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('checks right away, then every intervalMs, until the video is ready', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetch = fakeBfl(result({ status: 'Pending' }), result({ status: 'Generating' }), READY)
    const done = client(fetch).videos.wait(JOB, { intervalMs: 1_000 })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetch).toHaveBeenCalledTimes(3)
    await expect(done).resolves.toMatchObject({ status: 'ready' })
  })

  test('returns a failed job instead of throwing when the video fails', async () => {
    const fetch = fakeBfl(result({ status: 'Error' }))
    await expect(client(fetch).videos.wait(JOB)).resolves.toMatchObject({ status: 'failed' })
  })

  test('keeps waiting after a retryable error', async () => {
    const fetch = fakeBfl(new Response('Service Unavailable', { status: 503 }), READY)
    const job = await client(fetch).videos.wait(JOB, { intervalMs: 1 })
    expect(job).toMatchObject({ status: 'ready' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('throws right away on an error that is not retryable', async () => {
    const fetch = fakeBfl(failure(403, 'Not authenticated'), READY)
    await expect(client(fetch).videos.wait(JOB, { intervalMs: 1 })).rejects.toMatchObject({
      code: 'invalid_api_key',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test("stops and throws the signal's reason when the signal aborts", async () => {
    const controller = new AbortController()
    const fetch = fakeBfl(result({ status: 'Pending' }))
    const done = client(fetch).videos.wait(JOB, { intervalMs: 60_000, signal: controller.signal })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(done).rejects.toBe(controller.signal.reason)
  })
})
