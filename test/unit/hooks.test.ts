import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { client, failure, fakeBfl, INPUT, JOB, READY, result, SUBMITTED } from './fake-bfl.js'

describe('hooks', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('calls onSubmitFailed with the input, the error and the start time when fromText throws', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_700_000_000_000 })
    const onSubmitFailed = vi.fn()
    const bfl = client(fakeBfl(failure(402, 'Insufficient credits')))
    bfl.videos.registerHooks({ onSubmitFailed })
    const err = await bfl.videos.fromText(INPUT).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'insufficient_credits' })
    expect(onSubmitFailed).toHaveBeenCalledExactlyOnceWith(INPUT, err, 1_700_000_000_000)
  })

  test('calls onJobProgress while the job runs, then onJobReady', async () => {
    const hooks = { onJobProgress: vi.fn(), onJobReady: vi.fn(), onJobFailed: vi.fn() }
    const bfl = client(
      fakeBfl(result({ status: 'Pending' }), result({ status: 'Generating' }), READY),
    )
    bfl.videos.registerHooks(hooks)
    const job = await bfl.videos.wait(JOB, { intervalMs: 1 })
    const statuses = hooks.onJobProgress.mock.calls.map(([running]) => running.processingStatus)
    expect(statuses).toEqual(['Pending', 'Generating'])
    expect(hooks.onJobReady).toHaveBeenCalledExactlyOnceWith(job)
    expect(hooks.onJobFailed).not.toHaveBeenCalled()
  })

  test('calls onJobProgress only when the progress or processingStatus changed', async () => {
    const onJobProgress = vi.fn()
    const bfl = client(
      fakeBfl(
        result({ status: 'Pending' }),
        result({ status: 'Pending' }),
        result({ status: 'Generating', progress: 0.2 }),
        result({ status: 'Generating', progress: 0.2 }),
        result({ status: 'Generating', progress: 0.6 }),
        READY,
      ),
    )
    bfl.videos.registerHooks({ onJobProgress })
    await bfl.videos.wait(JOB, { intervalMs: 1 })
    const seen = onJobProgress.mock.calls.map(([job]) => [job.processingStatus, job.progress])
    expect(seen).toEqual([
      ['Pending', undefined],
      ['Generating', 0.2],
      ['Generating', 0.6],
    ])
  })

  test('calls onJobFailed when the job fails', async () => {
    const onJobFailed = vi.fn()
    const bfl = client(fakeBfl(result({ status: 'Content Moderated' })))
    bfl.videos.registerHooks({ onJobFailed })
    const job = await bfl.videos.check(JOB)
    expect(onJobFailed).toHaveBeenCalledExactlyOnceWith(job)
  })

  test('calls no hook when fromText succeeds or when checking a job that already ended', async () => {
    const hooks = {
      onSubmitFailed: vi.fn(),
      onJobProgress: vi.fn(),
      onJobReady: vi.fn(),
      onJobFailed: vi.fn(),
    }
    const bfl = client(fakeBfl(SUBMITTED, READY))
    bfl.videos.registerHooks(hooks)
    await bfl.videos.fromText(INPUT)
    await bfl.videos.check(await bfl.videos.check(JOB))
    expect(hooks.onSubmitFailed).not.toHaveBeenCalled()
    expect(hooks.onJobProgress).not.toHaveBeenCalled()
    expect(hooks.onJobReady).toHaveBeenCalledOnce()
  })

  test('ignores hooks that throw or reject, and still runs the other hooks', async () => {
    const onJobReady = vi.fn()
    const bfl = client(fakeBfl(READY))
    bfl.videos.registerHooks({
      onJobReady: () => {
        throw new Error('sync')
      },
    })
    bfl.videos.registerHooks({ onJobReady: async () => Promise.reject(new Error('async')) })
    bfl.videos.registerHooks({ onJobReady })
    await expect(bfl.videos.check(JOB)).resolves.toMatchObject({ status: 'ready' })
    expect(onJobReady).toHaveBeenCalledOnce()
  })

  test('waits for async hooks before returning', async () => {
    let finished = false
    const bfl = client(fakeBfl(READY))
    bfl.videos.registerHooks({
      onJobReady: async () => {
        await sleep(10)
        finished = true
      },
    })
    await bfl.videos.check(JOB)
    expect(finished).toBe(true)
  })
})
