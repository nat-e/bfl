import { afterEach, describe, expect, test, vi } from 'vitest'
import { Bfl } from '../../src/index.js'
import { fakeBfl, INPUT, SUBMITTED, sentRequest } from './fake-bfl.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('new Bfl()', () => {
  test('reads the API key from BFL_API_KEY', async () => {
    vi.stubEnv('BFL_API_KEY', 'env-key')
    const fetch = fakeBfl(SUBMITTED)
    await new Bfl({ fetch }).videos.fromText(INPUT)
    expect(sentRequest(fetch).headers.get('x-key')).toBe('env-key')
  })

  test('prefers the apiKey option over BFL_API_KEY', async () => {
    vi.stubEnv('BFL_API_KEY', 'env-key')
    const fetch = fakeBfl(SUBMITTED)
    await new Bfl({ apiKey: 'option-key', fetch }).videos.fromText(INPUT)
    expect(sentRequest(fetch).headers.get('x-key')).toBe('option-key')
  })

  test('throws missing_api_key when no key is passed and BFL_API_KEY is not set', () => {
    vi.stubEnv('BFL_API_KEY', undefined)
    expect(() => new Bfl()).toThrow(expect.objectContaining({ code: 'missing_api_key' }))
  })

  test.each([
    { region: undefined, host: 'https://api.bfl.ai' },
    { region: 'eu', host: 'https://api.eu.bfl.ai' },
    { region: 'us', host: 'https://api.us.bfl.ai' },
  ] as const)('sends new jobs to $host when region is $region', async ({ region, host }) => {
    const fetch = fakeBfl(SUBMITTED)
    await new Bfl({ apiKey: 'test-key', region, fetch }).videos.fromText(INPUT)
    expect(new URL(sentRequest(fetch).url).origin).toBe(host)
  })
})
