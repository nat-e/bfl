import assert from 'node:assert/strict'
// @ts-types="../../dist/index.d.mts"
import { Bfl, BflError } from '../../dist/index.mjs'
import pkg from '../../package.json' with { type: 'json' }

const POLLING_URL = 'https://api.us1.bfl.ai/v1/get_result?id=job-1'
const VIDEO_URL = 'https://delivery-us1.bfl.ai/results/job-1/sample.mp4'
const SUBMITTED = { id: 'job-1', polling_url: POLLING_URL, cost: 150 }
const READY = { id: 'job-1', status: 'Ready', result: { sample: VIDEO_URL }, cost: 150 }

// A fetch that answers each call with the next JSON body, and keeps the requests.
function fakeBfl(...replies: unknown[]) {
  const requests: { url: string; headers: Headers }[] = []
  const fetch: typeof globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers) })
    return Response.json(replies[requests.length - 1])
  }
  return { fetch, requests }
}

Deno.test('loads the built SDK and starts and checks a job', async () => {
  const { fetch } = fakeBfl(SUBMITTED, READY)
  const bfl = new Bfl({ apiKey: 'test-key', fetch })
  const started = await bfl.videos.fromText({ model: 'flux3', prompt: 'A fox walking in the snow' })
  const job = await bfl.videos.check(started)
  assert.equal(job.status, 'ready')
  assert.equal(job.status === 'ready' && job.media.url, VIDEO_URL)
})

Deno.test('sends a bfl-sdk-js/<version> Deno/<version> User-Agent', async () => {
  const { fetch, requests } = fakeBfl(SUBMITTED)
  await new Bfl({ apiKey: 'test-key', fetch }).videos.fromText({ model: 'flux3', prompt: 'A fox' })
  const userAgent = requests[0]?.headers.get('user-agent')
  assert.equal(userAgent, `bfl-sdk-js/${pkg.version} Deno/${Deno.version.deno}`)
})

Deno.test({
  name: 'throws missing_api_key when Deno denies access to the environment',
  permissions: { env: false },
  fn() {
    const { fetch } = fakeBfl()
    assert.throws(
      () => new Bfl({ fetch }),
      (err) => BflError.isInstance(err) && err.code === 'missing_api_key',
    )
  },
})
