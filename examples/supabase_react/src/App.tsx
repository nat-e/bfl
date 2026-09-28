import { createClient, FunctionsHttpError } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

type Video = {
  id: string
  prompt: string
  status: 'pending' | 'ready' | 'failed'
  error: string | null
  video_url: string | null
}

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null)
  const [videos, setVideos] = useState<Video[]>([])

  async function loadVideos() {
    const { data } = await supabase
      .from('videos')
      .select('id, prompt, status, error, video_url')
      .order('created_at', { ascending: false })
    if (data) {
      setVideos(data)
    }
  }

  // Refresh every 5 s to pick up finished videos.
  useEffect(() => {
    loadVideos()
    const timer = setInterval(loadVideos, 5000)
    return () => clearInterval(timer)
  }, [])

  async function generate() {
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.functions.invoke('generate', {
      body: { prompt, duration: duration ? Number(duration) : undefined },
    })
    if (error) {
      // The function answers errors with { error, retryable }.
      const body =
        error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
      setError({ message: body?.error ?? error.message, retryable: body?.retryable === true })
    } else {
      setPrompt('')
      await loadVideos()
    }
    setSubmitting(false)
  }

  return (
    <main>
      <h1>FLUX 3 Video (Supabase/React)</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          generate()
        }}
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your video…"
          required
        />
        <label>
          Duration (5–20 s){' '}
          <input
            type="number"
            min={5}
            max={20}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="auto"
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Generate'}
        </button>
        {error && <p className="error">{error.message}</p>}
        {/* Only for temporary errors (rate limit, BFL down): the same request may work now. */}
        {error?.retryable && (
          <button type="button" onClick={generate}>
            Try again
          </button>
        )}
      </form>
      <ul>
        {videos.map((video) => (
          <li key={video.id}>
            {video.status === 'ready' && video.video_url && (
              <video src={video.video_url} controls playsInline preload="metadata" />
            )}
            {video.status === 'pending' && (
              <div className="placeholder">Generating… (can take up to 10 min)</div>
            )}
            {video.status === 'failed' && <div className="placeholder">Failed: {video.error}</div>}
            <p>{video.prompt}</p>
          </li>
        ))}
      </ul>
    </main>
  )
}
