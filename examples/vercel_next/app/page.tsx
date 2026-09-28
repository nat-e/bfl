'use client'

import { useEffect, useState } from 'react'

type Video = {
  id: string
  prompt: string
  status: 'pending' | 'ready' | 'failed'
  error: string | null
  video_url: string | null
}

export default function Page() {
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null)
  const [videos, setVideos] = useState<Video[]>([])

  async function loadVideos() {
    const res = await fetch('/api/videos')
    if (res.ok) {
      setVideos(await res.json())
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
    const res = await fetch('/api/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, duration: duration ? Number(duration) : undefined }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError({
        message: body?.error ?? `Error ${res.status}`,
        retryable: body?.retryable === true,
      })
    } else {
      setPrompt('')
      await loadVideos()
    }
    setSubmitting(false)
  }

  return (
    <main>
      <h1>FLUX 3 Video (Vercel/Next.js)</h1>
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
        {/* Only for errors the SDK marks as temporary: the same request may work now. */}
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
