import '../_shared/tracing.ts' // sends the SDK's spans to Langfuse
import { withSupabase } from 'npm:@supabase/server@1'
import { Bfl, BflError } from '@bfl/sdk'

// Starts a FLUX 3 video generation and saves it as a pending video.
export default {
  fetch: withSupabase({ auth: 'publishable' }, async (req, ctx) => {
    const { prompt, duration } = await req.json()
    if (!prompt?.trim()) {
      return Response.json({ error: 'Prompt is required' }, { status: 400 })
    }

    // With recordContent, the SDK's span also holds the prompt, so Langfuse shows it.
    const bfl = new Bfl({ telemetry: { recordContent: true } })
    try {
      const job = await bfl.videos.fromText({ model: 'flux3', prompt, duration })
      // The job is plain JSON: poll reads it back from the row to check it.
      const { error } = await ctx.supabaseAdmin.from('videos').insert({ id: job.id, prompt, job })
      if (error) {
        return Response.json({ error: error.message }, { status: 500 })
      }
      return Response.json({ id: job.id })
    } catch (err) {
      if (!BflError.isInstance(err)) {
        throw err
      }
      // err.message says what went wrong and what to do. retryable is true for temporary
      // errors (rate limit, BFL down): the page then offers to try again.
      return Response.json({ error: err.message, retryable: err.retryable }, { status: 502 })
    }
  }),
}
