import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { VERSION } from '../../src/version.js'
import {
  client,
  failure,
  fakeBfl,
  INPUT,
  JOB,
  READY,
  result,
  SUBMITTED,
  VIDEO_URL,
} from './fake-bfl.js'

const exporter = new InMemorySpanExporter()
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })

beforeAll(() => {
  trace.setGlobalTracerProvider(provider)
})

afterEach(() => {
  exporter.reset()
})

afterAll(() => {
  trace.disable()
})

// Spans reach the exporter asynchronously.
async function finishedSpans(): Promise<ReadableSpan[]> {
  await provider.forceFlush()
  return exporter.getFinishedSpans()
}

async function onlySpan(): Promise<ReadableSpan> {
  const spans = await finishedSpans()
  expect(spans).toHaveLength(1)
  return spans[0] as ReadableSpan
}

describe('telemetry', () => {
  test("writes one span when check sees the video end, starting at the job's startedAt", async () => {
    await client(fakeBfl(READY)).videos.check(JOB)
    const span = await onlySpan()
    expect(span.instrumentationScope.name).toBe('@bfl/sdk')
    expect(span.kind).toBe(SpanKind.CLIENT)
    expect(span.startTime).toEqual([JOB.startedAt / 1000, 0])
  })

  test('puts the model, response id, user.id, video settings and cost (credits and US dollars) on the span', async () => {
    const input = {
      ...INPUT,
      duration: 10,
      resolution: 'fhd',
      aspectRatio: '16:9',
      audio: false,
      user: 'user-42',
    } as const
    await client(fakeBfl(READY)).videos.check({ ...JOB, input })
    expect((await onlySpan()).attributes).toMatchObject({
      'gen_ai.provider.name': 'black_forest_labs',
      'gen_ai.request.model': 'flux3',
      'gen_ai.response.id': JOB.id,
      'user.id': 'user-42',
      'black_forest_labs.video.duration': 10,
      'black_forest_labs.video.resolution': 'fhd',
      'black_forest_labs.video.aspect_ratio': '16:9',
      'black_forest_labs.video.audio': false,
      'black_forest_labs.cost.credits': 150,
      'gen_ai.usage.cost': 1.5,
    })
  })

  test.each([
    { how: 'fails', status: 'Error', finishReason: 'error', errorType: 'error' },
    {
      how: 'is blocked',
      status: 'Content Moderated',
      finishReason: 'content_filter',
      errorType: 'content_moderated',
    },
  ])(
    'writes an error span with finish reason $finishReason when the video $how',
    async ({ status, finishReason, errorType }) => {
      await client(fakeBfl(result({ status }))).videos.check(JOB)
      const span = await onlySpan()
      expect(span.status.code).toBe(SpanStatusCode.ERROR)
      expect(span.attributes).toMatchObject({
        'gen_ai.response.finish_reasons': [finishReason],
        'error.type': errorType,
      })
    },
  )

  test('writes an error span when fromText is rejected', async () => {
    const fetch = fakeBfl(failure(402, 'Insufficient credits'))
    await expect(client(fetch).videos.fromText(INPUT)).rejects.toThrow()
    const span = await onlySpan()
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.attributes).toMatchObject({ 'error.type': 'insufficient_credits' })
  })

  test('writes no span for a job that is starting or still running', async () => {
    const bfl = client(fakeBfl(SUBMITTED, result({ status: 'Generating' })))
    const started = await bfl.videos.fromText(INPUT)
    await bfl.videos.check(started)
    expect(await finishedSpans()).toHaveLength(0)
  })

  test('leaves the prompt and video URL off spans by default', async () => {
    await client(fakeBfl(READY)).videos.check(JOB)
    const attributes = JSON.stringify((await onlySpan()).attributes)
    expect(attributes).not.toContain(INPUT.prompt)
    expect(attributes).not.toContain(VIDEO_URL)
  })

  test('records the prompt and video URL with recordContent: true', async () => {
    await client(fakeBfl(READY), { telemetry: { recordContent: true } }).videos.check(JOB)
    const { attributes } = await onlySpan()
    expect(attributes['gen_ai.input.messages']).toContain(INPUT.prompt)
    expect(attributes['gen_ai.output.messages']).toContain(VIDEO_URL)
  })

  test('writes spans through the tracerProvider passed in, not the global one', async () => {
    const ownExporter = new InMemorySpanExporter()
    const tracerProvider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter: ownExporter })],
    })
    await client(fakeBfl(READY), { telemetry: { tracerProvider } }).videos.check(JOB)
    await tracerProvider.forceFlush()
    const [span] = ownExporter.getFinishedSpans()
    expect(span?.instrumentationScope).toMatchObject({ name: '@bfl/sdk', version: VERSION })
    expect(await finishedSpans()).toHaveLength(0)
  })
})
