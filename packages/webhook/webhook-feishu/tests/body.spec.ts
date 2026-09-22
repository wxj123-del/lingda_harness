import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { readBoundedUtf8Body } from '../src/body.ts'

function request(options: {
  chunks?: Array<Buffer | string>
  contentLength?: string
  complete?: boolean
  error?: unknown
} = {}): IncomingMessage & { resume: ReturnType<typeof vi.fn> } {
  const resume = vi.fn()
  return {
    headers: {
      ...(options.contentLength === undefined ? {} : { 'content-length': options.contentLength }),
    },
    complete: options.complete ?? true,
    resume,
    async * [Symbol.asyncIterator]() {
      for (const chunk of options.chunks ?? []) yield chunk
      if (options.error !== undefined) throw options.error
    },
  } as unknown as IncomingMessage & { resume: ReturnType<typeof vi.fn> }
}

describe('Feishu bounded request body', () => {
  it('accepts a bounded UTF-8 body', async () => {
    await expect(readBoundedUtf8Body(request({ chunks: [Buffer.from('{'), '}'] }), 2)).resolves.toBe('{}')
  })

  it('rejects invalid and oversized declared lengths', async () => {
    await expect(readBoundedUtf8Body(request({ contentLength: '01' }), 10)).rejects.toMatchObject({ status: 400 })
    const oversized = request({ contentLength: '3' })
    await expect(readBoundedUtf8Body(oversized, 2)).rejects.toMatchObject({ status: 413 })
    expect(oversized.resume).toHaveBeenCalledOnce()
  })

  it('rejects oversized, aborted, and invalid UTF-8 streams', async () => {
    const streamed = request({ chunks: ['ab', 'c'] })
    await expect(readBoundedUtf8Body(streamed, 2)).rejects.toMatchObject({ status: 413 })
    expect(streamed.resume).toHaveBeenCalledOnce()
    await expect(readBoundedUtf8Body(request({ error: new Error('socket') }), 10))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
    await expect(readBoundedUtf8Body(request({ complete: false }), 10))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
    await expect(readBoundedUtf8Body(request({ chunks: [Buffer.from([0xff])] }), 1))
      .rejects.toMatchObject({ status: 400, message: 'request body is not valid UTF-8' })
  })
})
