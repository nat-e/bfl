import { describe, expect, test, vi } from 'vitest'
import { BflError, type BflErrorCode } from '../../src/index.js'

// A Record, so the typecheck fails when a code is added without deciding here.
const RETRYABLE: Record<BflErrorCode, boolean> = {
  missing_api_key: false,
  invalid_api_key: false,
  invalid_request: false,
  insufficient_credits: false,
  rate_limited: true,
  server_error: true,
  network_error: true,
  timeout: true,
  unknown_error: false,
  invalid_job: false,
  job_not_found: false,
}

describe('BflError', () => {
  test('marks only rate_limited, server_error, network_error and timeout as retryable', () => {
    for (const [code, retryable] of Object.entries(RETRYABLE)) {
      expect(new BflError(code as BflErrorCode, 'message').retryable, code).toBe(retryable)
    }
  })

  test('BflError.isInstance recognizes a BflError from another copy of the SDK and rejects other errors', async () => {
    vi.resetModules()
    const copy = await import('../../src/index.js')
    const fromCopy = new copy.BflError('timeout', 'message')
    expect(fromCopy).not.toBeInstanceOf(BflError)
    expect(BflError.isInstance(fromCopy)).toBe(true)
    expect(BflError.isInstance(new Error('message'))).toBe(false)
    expect(BflError.isInstance({ name: 'BflError', code: 'timeout', message: 'message' })).toBe(
      false,
    )
  })
})
