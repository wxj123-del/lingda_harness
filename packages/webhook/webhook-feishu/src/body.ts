/** Bounded UTF-8 request-body intake for Feishu callbacks. */

import type { IncomingMessage } from 'node:http'

export class FeishuHttpError extends Error {
  override readonly name = 'FeishuHttpError'
  constructor(readonly status: 400 | 401 | 403 | 405 | 413 | 415 | 503, message: string) { super(message) }
}

function contentLength(request: IncomingMessage): number | undefined {
  const value = request.headers['content-length']
  if (value === undefined) return undefined
  if (!/^(0|[1-9]\d*)$/u.test(value)) throw new FeishuHttpError(400, 'invalid Content-Length')
  const length = Number(value)
  if (!Number.isSafeInteger(length)) throw new FeishuHttpError(413, 'request body is too large')
  return length
}

export async function readBoundedUtf8Body(request: IncomingMessage, maxBytes: number): Promise<string> {
  const declared = contentLength(request)
  if (declared !== undefined && declared > maxBytes) {
    request.resume()
    throw new FeishuHttpError(413, 'request body is too large')
  }
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      total += bytes.length
      if (total > maxBytes) {
        request.resume()
        throw new FeishuHttpError(413, 'request body is too large')
      }
      chunks.push(bytes)
    }
  } catch (error: unknown) {
    if (error instanceof FeishuHttpError) throw error
    throw new FeishuHttpError(400, 'request body was aborted')
  }
  if (!request.complete) throw new FeishuHttpError(400, 'request body was aborted')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))
  } catch {
    throw new FeishuHttpError(400, 'request body is not valid UTF-8')
  }
}
