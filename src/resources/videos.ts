import type { AsyncSubmitResponse, ResultResponse } from '../api/types.js'
import { BflError } from '../errors.js'
import type { JobHooks } from '../hooks.js'
import type { HttpClient, HttpRequestOptions } from '../http.js'
import {
  advanceInProgress,
  advanceToFailed,
  advanceToReady,
  type BaseJobInput,
  type FailedJob,
  type InProgressJob,
  type Job,
  type JobError,
  type ReadyJob,
} from '../job.js'
import { sleep } from '../utils.js'
import { VideoModelFlux3 } from './videos/models/flux3.js'
import type { VideoModel, VideoModelId } from './videos/models/video_model.js'

// A repository containing all models with video capability.
const MODELS: Record<VideoModelId, VideoModel<VideoModelId>> = { flux3: new VideoModelFlux3() }

/**
 * Base input for video generation jobs
 */
export type VideoInput = BaseJobInput & {
  model: VideoModelId

  /** The prompt describing to the model what to do.
   * Check https://docs.bfl.ai/guides/prompting_video_text_to_video for guidance.
   */
  prompt: string

  /**
   * The duration of the video in whole seconds. Supported range: 5 - 20.
   * Default: Automatically detected from the prompt.
   */
  duration?: number

  /**
   * The resolution of the video: `hd`, or `fhd`, `qhd` or `uhd` for a higher resolution made by
   * upscaling. The exact size depends on the aspect ratio. Default: `hd`.
   */
  resolution?: 'hd' | 'fhd' | 'qhd' | 'uhd'

  /** The aspect ratio of the video. Default: `auto`, chosen from the prompt. */
  aspectRatio?: 'auto' | '21:9' | '2:1' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '9:21'

  /** Generate audio with the video. Default: `true`. */
  audio?: boolean
}

/** Input for creating a text to video generation Job. */
// INFO: This abstraction is unnecessary now, but it shows how I would split inputs when
// adding support for multiple modes
export type VideoFromTextInput = VideoInput & {}

/** A video generation Job, as returned by {@link Videos.fromText} and {@link Videos.check}. */
export type VideoJob = Job<VideoFromTextInput>

/** Options for {@link Videos.wait}. */
export type WaitOptions = {
  /** How long to pause between checks, in ms. Default: 5 000 (5 s). */
  intervalMs?: number

  /**
   * Stops waiting. `wait` then throws the signal's reason (an `AbortError` by default), not a
   * `BflError`. Without it, `wait` has no time limit.
   */
  signal?: AbortSignal
}

/** Module for generating videos.
 * Accessed with `new Bfl().videos`
 * Call {@link Videos.fromText} to generate a video from a prompt.
 **/
export class Videos {
  readonly #http: HttpClient
  readonly #hooks: JobHooks<VideoFromTextInput>[] = []

  constructor(http: HttpClient) {
    this.#http = http
  }

  /**
   * Registers hooks the SDK calls for every video job of this client: when a job can't be
   * started, when a check finds its progress or status changed, and when it is ready or failed.
   * Hooks run in {@link Videos.fromText} and {@link Videos.check}, so also in {@link Videos.wait}.
   *
   * @param hooks - The hooks to call. Every hook is optional.
   *
   * @example
   * ```ts
   * bfl.videos.registerHooks({
   *   onJobProgress: (job) => progressBar.update(job.progress ?? 0),
   * })
   * const job = await bfl.videos.wait(started)
   * ```
   */
  registerHooks(hooks: JobHooks<VideoFromTextInput>): void {
    this.#hooks.push(hooks)
  }

  /**
   * Starts generating a video from a text prompt.
   *
   * @param input - The settings for video generation
   * @param options - Options for configuring the HTTP request
   *
   * @returns The asynchronous job for the processing.
   * Save it, then pass it to {@link Videos.check} to get its status.
   * @throws {@link BflError} when the video can't be started, e.g. `invalid_request`,
   * `insufficient_credits` or `rate_limited`.
   *
   * @example
   * ```ts
   * const job = await bfl.videos.fromText({ model: 'flux3', prompt: 'A cat surfing a wave' })
   * await db.save(JSON.stringify(job))
   * ```
   */
  async fromText(
    input: VideoFromTextInput,
    options?: HttpRequestOptions,
  ): Promise<InProgressJob<VideoFromTextInput>> {
    const startedAt = Date.now()
    const model = getModelOrThrow(input.model)
    try {
      const response = await this.#http.post<AsyncSubmitResponse>(
        model.endpoint,
        model.makeFromTextBody(input),
        options,
      )
      return {
        id: response.id,
        status: 'in_progress',
        pollingUrl: response.polling_url,
        cost: response.cost ?? undefined,
        input,
        startedAt,
      }
    } catch (err) {
      if (err instanceof BflError) {
        await this.#runHooks((hooks) => hooks.onSubmitFailed?.(input, err, startedAt))
      }
      throw err
    }
  }

  /**
   * Polls the API to check the status of a Job.
   * Only jobs with in_progress status are checked. Other jobs are returned unchanged.
   * The input Job will not be mutated, an updated Job object will be returned.
   * A job for which the processing failed is returned with status `failed`, not thrown.
   * Runs the registered {@link JobHooks} for the new state before returning.
   *
   * @param job - The Job to check
   * @param options - Options for configuring the HTTP request
   * @returns A copy of the Job, with the updated state
   * @throws {@link BflError} when the status can't be checked, e.g. `job_not_found` (BFL already
   * deleted the job), `invalid_job` or `network_error`.
   *
   * @example
   * ```ts
   * const job = await bfl.videos.check(JSON.parse(await db.load()))
   * if (job.status === 'ready') console.log(job.media.url)
   * ```
   */
  // INFO: Users should not have to serialize and pass a Job, it should be fully reconstructible
  // from the ID.
  async check<JobInput extends VideoInput>(
    job: Job<JobInput>,
    options?: HttpRequestOptions,
  ): Promise<Job<JobInput>> {
    if (job.status !== 'in_progress') {
      return job
    }
    const response = await this.#http.getCustomUrl<ResultResponse>(job.pollingUrl, options)
    // Replies may leave the cost out: keep the last known one.
    const cost = response.cost ?? job.cost

    if (response.status === 'Ready' && response.result) {
      const updatedJob = advanceToReady(job, {
        cost,
        media: {
          url: response.result.sample,
          mimeType: 'video/mp4',
        },
      })
      await this.#runHooks((hooks) => hooks.onJobReady?.(updatedJob))
      return updatedJob
    }

    const error = toJobError(response)
    if (error) {
      const updatedJob = advanceToFailed(job, {
        error,
        cost,
      })
      await this.#runHooks((hooks) => hooks.onJobFailed?.(updatedJob))
      return updatedJob
    }
    const updatedJob = advanceInProgress(job, {
      processingStatus: response.status,
      // Replies for running jobs may leave it out: keep the last known value.
      progress: response.progress ?? job.progress,
      cost,
    })
    // Only when the job moved on, so checks that learn nothing new don't repeat the hook.
    if (
      updatedJob.processingStatus !== job.processingStatus ||
      updatedJob.progress !== job.progress
    ) {
      await this.#runHooks((hooks) => hooks.onJobProgress?.(updatedJob))
    }
    return updatedJob
  }

  /**
   * Waits for a Job to complete.
   * Thif will check right away, then every `intervalMs`, until it is ready or failed.
   * Checks that throw a retryable error are skipped. There is no time limit: pass a `signal`
   * to stop.
   *
   * @param job - The Job to wait for
   * @param options - The pause between checks, and a signal to stop
   * @returns The Job, ready or failed
   * @throws {@link BflError} when a check fails with an error that is not retryable, e.g.
   * `job_not_found` or `invalid_api_key`.
   *
   * @example
   * ```ts
   * const started = await bfl.videos.fromText({ model: 'flux3', prompt: 'A cat surfing a wave' })
   * const job = await bfl.videos.wait(started, { signal: AbortSignal.timeout(3_600_000) })
   * if (job.status === 'ready') console.log(job.media.url)
   * ```
   */
  async wait<JobInput extends VideoInput>(
    job: Job<JobInput>,
    options: WaitOptions = {},
  ): Promise<ReadyJob<JobInput> | FailedJob<JobInput>> {
    const { intervalMs = 5_000, signal } = options
    for (;;) {
      try {
        job = await this.check(job, { signal })
      } catch (err) {
        if (!BflError.isInstance(err) || !err.retryable) {
          throw err
        }
      }
      if (job.status !== 'in_progress') {
        return job
      }
      await sleep(intervalMs, signal)
    }
  }

  // Runs every registered hook at the same time and waits for all of them, even when one throws.
  // A broken hook never breaks the SDK call.
  async #runHooks(
    run: (hooks: JobHooks<VideoFromTextInput>) => void | Promise<void>,
  ): Promise<void> {
    await Promise.allSettled(this.#hooks.map(async (hooks) => run(hooks)))
  }
}

// A failed job's error, or undefined when the status is not a failure.
function toJobError(response: ResultResponse): JobError | undefined {
  switch (response.status) {
    case 'Error': {
      const message = response.details?.error
      return { type: 'error', message: typeof message === 'string' ? message : undefined }
    }
    case 'Request Moderated':
    case 'Content Moderated': {
      const reasons = response.details?.['Moderation Reasons']
      return {
        type: response.status === 'Content Moderated' ? 'content_moderated' : 'request_moderated',
        reasons: reasons ?? [],
      }
    }
    default:
      return undefined
  }
}

function getModelOrThrow<ModelId extends VideoModelId>(id: ModelId): VideoModel<VideoModelId> {
  if (!Object.hasOwn(MODELS, id)) {
    throw new BflError(
      'invalid_request',
      `Unknown video model: ${id}. Must be one of: ${Object.keys(MODELS).join(',')}`,
    )
  }
  return MODELS[id]
}
