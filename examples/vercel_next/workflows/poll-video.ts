import { Bfl, type JobError, type ReadyJob, type VideoJob } from '@bfl/sdk'
import { put } from '@vercel/blob'
import { sleep } from 'workflow'
import { sql } from '@/lib/db'

// Checks the job every 10 s until the video is saved as ready or failed, for up to 1 hour.
// Sleeping costs nothing, so no request waits for the video.
export async function pollVideo(job: VideoJob) {
  'use workflow'

  let lastError: string | undefined
  for (let i = 0; i < 360; i++) {
    await sleep('10s')
    try {
      job = await checkJob(job)
      if (job.status === 'ready') {
        await saveVideo(job)
        return
      }
      if (job.status === 'failed') {
        await markFailed(job.id, failureReason(job.error))
        return
      }
    } catch (err) {
      // Workflow already retried the step 3 times and logged the error: try again at the next
      // check. Its message starts with `Step "…" failed after 3 retries: `, which is cut.
      lastError = (err as Error).message.replace(/^Step ".*?" failed after .*?: /, '')
    }
  }
  await markFailed(job.id, lastError ? `Timed out: ${lastError}` : 'Timed out')
}

async function checkJob(job: VideoJob) {
  'use step'

  const bfl = new Bfl({ telemetry: { recordContent: true } })
  // Ready and failed jobs come back as is, without a new request to BFL.
  return bfl.videos.check(job)
}

// Its own step, so a failed copy is retried without asking BFL again.
async function saveVideo(job: ReadyJob) {
  'use step'

  const videoUrl = await copyVideo(job.id, job.media.url)
  await sql`update videos set status = 'ready', video_url = ${videoUrl} where id = ${job.id}`
}

// Copies a finished video to Blob, because BFL result links expire.
async function copyVideo(id: string, sampleUrl: string) {
  const file = await fetch(sampleUrl)
  if (!file.ok) {
    throw new Error(`Download failed: ${file.status}`)
  }
  const blob = await put(`${id}.mp4`, await file.arrayBuffer(), {
    access: 'public',
    contentType: 'video/mp4',
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: true,
  })
  return blob.url
}

// What to show on the page, with the next step,
// e.g. "Video blocked by moderation (violence). Try another prompt."
function failureReason(error: JobError) {
  if (error.type === 'error') {
    const reason = error.message ? ` (${error.message.replace(/\.$/, '')})` : ''
    return `Generation failed${reason}. Try again.`
  }
  const what = error.type === 'request_moderated' ? 'Prompt' : 'Video'
  const reasons = error.reasons.join(', ').replaceAll('_', ' ')
  return `${what} blocked by moderation${reasons ? ` (${reasons})` : ''}. Try another prompt.`
}

async function markFailed(id: string, error: string) {
  'use step'

  await sql`update videos set status = 'failed', error = ${error} where id = ${id}`
}
