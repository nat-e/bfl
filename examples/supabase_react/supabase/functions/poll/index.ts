import '../_shared/tracing.ts' // sends the SDK's spans to Langfuse
import { type SupabaseContext, withSupabase } from 'npm:@supabase/server@1'
import { Bfl, type JobError } from '@bfl/sdk'

// Called by a cron job every 10 s while videos are pending (see the init migration).
export default {
  fetch: withSupabase({ auth: 'none' }, async (_req, ctx) => {
    const db = ctx.supabaseAdmin
    const { data: videos, error } = await db.from('videos').select().eq('status', 'pending')
    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    const bfl = new Bfl({ telemetry: { recordContent: true } })
    for (const video of videos) {
      const update = (fields: object) => db.from('videos').update(fields).eq('id', video.id)
      // Give up after an hour, with the last error seen.
      if (Date.parse(video.created_at) < Date.now() - 60 * 60 * 1000) {
        const reason = video.error ? `Timed out: ${video.error}` : 'Timed out'
        await update({ status: 'failed', error: reason })
        continue
      }

      try {
        const job = await bfl.videos.check(video.job)
        if (job.status === 'failed') {
          await update({ status: 'failed', error: failureReason(job.error), job })
        } else if (job.status === 'ready') {
          await update({ job })
          const video_url = await storeVideo(db, video.id, job.media.url)
          await update({ status: 'ready', video_url })
        }
      } catch (e) {
        console.error(`Video ${video.id}:`, e) // checked again on the next run
        await update({ error: (e as Error).message })
      }
    }

    return Response.json({ pending: videos.length })
  }),
}

// Copies the video to Storage, because BFL result links expire. Returns its public URL.
async function storeVideo(db: SupabaseContext['supabaseAdmin'], id: string, url: string) {
  const file = await fetch(url)
  if (!file.ok) {
    throw new Error(`Download failed: ${file.status}`)
  }
  const storage = db.storage.from('videos')
  const path = `${id}.mp4`
  const { error } = await storage.upload(path, await file.blob(), { upsert: true })
  if (error) {
    throw error
  }
  return storage.getPublicUrl(path).data.publicUrl
}

// e.g. "Prompt blocked by moderation (violence). Try another prompt."
function failureReason(error: JobError) {
  if (error.type === 'error') {
    const message = error.message?.replace(/\.$/, '')
    return `Generation failed${message ? ` (${message})` : ''}. Try again.`
  }
  const what = error.type === 'request_moderated' ? 'Prompt' : 'Video'
  const reasons = error.reasons.join(', ').replaceAll('_', ' ')
  return `${what} blocked by moderation${reasons ? ` (${reasons})` : ''}. Try another prompt.`
}
