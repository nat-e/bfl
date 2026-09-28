import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, test, vi } from 'vitest'
import pkg from '../../package.json' with { type: 'json' }
import type { Bfl } from '../../src/index.js'
import {
  API_KEY,
  client,
  failure,
  fakeBfl,
  hangingFetch,
  INPUT,
  JOB,
  READY,
  result,
  SUBMITTED,
  sentRequest,
} from './fake-bfl.js'

const start = (bfl: Bfl) => bfl.videos.fromText(INPUT)
const check = (bfl: Bfl) => bfl.videos.check(JOB)

describe('http', () => {
  test('sends the API key and a bfl-sdk-js/<version> Node.js/<major> User-Agent', async () => {
    const fetch = fakeBfl(SUBMITTED)
    await client(fetch).videos.fromText(INPUT)
    const { headers } = sentRequest(fetch)
    expect(headers.get('x-key')).toBe(API_KEY)
    const major = process.versions.node.split('.')[0]
    expect(headers.get('user-agent')).toBe(`bfl-sdk-js/${pkg.version} Node.js/${major}`)
  })

  test.each([
    {
      answer: '403',
      reply: failure(403, 'Not authenticated'),
      call: start,
      code: 'invalid_api_key',
    },
    {
      answer: '422 Invalid API key format',
      reply: failure(422, 'Invalid API key format'),
      call: start,
      code: 'invalid_api_key',
    },
    {
      answer: '422',
      reply: failure(422, [{ loc: ['body', 'prompt'], msg: 'Field required' }]),
      call: start,
      code: 'invalid_request',
    },
    {
      answer: '402',
      reply: failure(402, 'Insufficient credits'),
      call: start,
      code: 'insufficient_credits',
    },
    {
      answer: '404 to a check',
      reply: Response.json(result({ status: 'Task not found' }), { status: 404 }),
      call: check,
      code: 'job_not_found',
    },
    {
      answer: '429',
      reply: failure(429, 'Too many active tasks'),
      call: start,
      code: 'rate_limited',
    },
    {
      answer: '500',
      reply: new Response('Internal Server Error', { status: 500 }),
      call: start,
      code: 'server_error',
    },
    {
      answer: '503',
      reply: new Response('Service Unavailable', { status: 503 }),
      call: start,
      code: 'server_error',
    },
    {
      answer: '200 with a body that is not JSON',
      reply: new Response('<html></html>'),
      call: start,
      code: 'unknown_error',
    },
  ])('throws $code when BFL answers $answer', async ({ reply, call, code }) => {
    await expect(call(client(fakeBfl(reply)))).rejects.toMatchObject({ name: 'BflError', code })
  })

  test("includes BFL's field path and message in invalid_request errors", async () => {
    const detail = [
      {
        type: 'greater_than_equal',
        loc: ['body', 't2v', 'duration'],
        msg: 'Input should be greater than or equal to 5',
        input: 4,
        ctx: { ge: 5 },
      },
    ]
    const started = client(fakeBfl(failure(422, detail))).videos.fromText({ ...INPUT, duration: 4 })
    await expect(started).rejects.toThrow(
      't2v.duration: Input should be greater than or equal to 5',
    )
  })

  test('throws network_error when BFL cannot be reached', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('fetch failed'))
    await expect(client(fetch).videos.fromText(INPUT)).rejects.toMatchObject({
      code: 'network_error',
    })
  })

  test('throws timeout when BFL does not answer within timeoutMs', async () => {
    await expect(
      client(hangingFetch).videos.fromText(INPUT, { timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'timeout' })
  })

  test('never times out with timeoutMs: Infinity', async () => {
    const slowFetch: typeof fetch = async (_url, init) => {
      await sleep(50, undefined, { signal: init?.signal ?? undefined })
      return Response.json(SUBMITTED)
    }
    await expect(
      client(slowFetch).videos.fromText(INPUT, { timeoutMs: Number.POSITIVE_INFINITY }),
    ).resolves.toMatchObject({ status: 'in_progress' })
  })

  test("throws the signal's reason, not a BflError, when the call is aborted", async () => {
    const controller = new AbortController()
    const started = client(hangingFetch).videos.fromText(INPUT, { signal: controller.signal })
    controller.abort()
    await expect(started).rejects.toBe(controller.signal.reason)
  })

  test.each([
    'https://example.com/v1/get_result?id=job-1',
    'https://evilbfl.ai/v1/get_result?id=job-1',
    'http://api.bfl.ai/v1/get_result?id=job-1',
  ])('refuses to send the API key to a pollingUrl outside BFL: %s', async (pollingUrl) => {
    const fetch = fakeBfl(READY)
    await expect(client(fetch).videos.check({ ...JOB, pollingUrl })).rejects.toMatchObject({
      code: 'invalid_job',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
