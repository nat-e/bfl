import type { BflError } from './errors.js'
import type { BaseJobInput, FailedJob, InProgressJob, ReadyJob } from './job.js'

/**
 * Hooks for executing code at various points in a Job's lifecycle.
 * Register them with `bfl.videos.registerHooks`. Every hook is optional.
 *
 * The SDK runs all registered hooks at the same time and waits for them before it returns.
 * Errors thrown by a hook are ignored: they never fail the SDK call or stop the other hooks.
 *
 * @example
 * ```ts
 * bfl.videos.registerHooks({
 *   onJobProgress: (job) => progressBar.update(job.progress ?? 0),
 *   onJobReady: (job) => console.log('Video ready:', job.media.url),
 * })
 * ```
 */
export type JobHooks<Input extends BaseJobInput = BaseJobInput> = {
  /**
   * Called when a job could not be started, before the error is thrown.
   *
   * @param input - The input the job was started with
   * @param err - The error that is about to be thrown
   * @param startedAt - When the SDK started sending the job, in ms since epoch
   */
  onSubmitFailed?(input: Input, err: BflError, startedAt: number): void | Promise<void>

  /**
   * Called when the job is ready.
   *
   * @param job - The ready job
   */
  onJobReady?(job: ReadyJob<Input>): void | Promise<void>

  /**
   * Called when the job failed, e.g. blocked by moderation.
   *
   * @param job - The failed job
   */
  onJobFailed?(job: FailedJob<Input>): void | Promise<void>

  /**
   * Called when a check finds the running job's `progress` or `processingStatus` changed, e.g. to
   * show `job.progress`.
   *
   * @param job - The running job
   */
  onJobProgress?(job: InProgressJob<Input>): void | Promise<void>
}
