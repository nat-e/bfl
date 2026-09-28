import { Bfl } from '@bfl/sdk'

const bfl = new Bfl() // reads BFL_API_KEY

// The hooks print everything: the script itself only starts the video and waits.
bfl.videos.registerHooks({
  // Runs only when the status or progress changed since the last check.
  onJobProgress: (job) => console.log(`${job.processingStatus}, progress: ${job.progress ?? '-'}`),
  onJobReady: (job) => console.log(`Ready (${job.cost} credits): ${job.media.url}`),
  onJobFailed: (job) => console.log('Failed:', job.error),
})

// The cheapest settings: each run still spends credits.
const started = await bfl.videos.fromText({
  model: 'flux3',
  prompt: 'A red fox walking through fresh snow at sunrise',
  duration: 5,
  resolution: 'hd',
  audio: false,
})
console.log(`Started job ${started.id}`)

await bfl.videos.wait(started)
