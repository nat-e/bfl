import { Bfl, BflError } from '@bfl/sdk'
import { start } from 'workflow/api'
import { sql } from '@/lib/db'
import { pollVideo } from '@/workflows/poll-video'

// Lists every video, newest first.
export async function GET() {
  const videos = await sql`
    select id, prompt, status, error, video_url from videos order by created_at desc
  `
  return Response.json(videos)
}

// Starts a FLUX 3 video generation, saves it as a pending video and starts polling it.
export async function POST(req: Request) {
  const { prompt, duration } = await req.json()
  if (!prompt?.trim()) {
    return Response.json({ error: 'Prompt is required' }, { status: 400 })
  }

  // Created per request: BFL_API_KEY isn't set during `next build`.
  // recordContent adds the prompt to the SDK's spans, so Langfuse shows it.
  const bfl = new Bfl({ telemetry: { recordContent: true } })
  try {
    const job = await bfl.videos.fromText({ model: 'flux3', prompt, duration })
    await sql`insert into videos (id, prompt) values (${job.id}, ${prompt})`
    // The job is plain data: the workflow keeps it between checks.
    await start(pollVideo, [job])
    return Response.json({ id: job.id })
  } catch (err) {
    if (!BflError.isInstance(err)) {
      throw err
    }
    // The SDK's message says what went wrong and what to do. retryable means the error is
    // temporary (rate limit, BFL down, timeout), so the page offers to try again.
    return Response.json({ error: err.message, retryable: err.retryable }, { status: 502 })
  }
}
