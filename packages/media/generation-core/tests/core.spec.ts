import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaConfigSchema, catalog, decodeBase64, readBytes, selectRoute, transport, validateConfig } from '../src/index.ts'

afterEach(() => vi.unstubAllGlobals())
const model = { id: 'image2', capabilities: ['text-to-image'] }
const provider = { api: 'openai-images', baseURL: 'https://provider.example/v1', anonymous: true, models: [model] }
const config = { providers: { test: provider } }

describe('media configuration and HTTP', () => {
  it('parses the dictionary configuration used by subscription profiles', () => {
    expect(MediaConfigSchema(config).providers).toMatchObject(config.providers)
    expect(MediaConfigSchema({}).providers).toEqual({})
    expect(() => MediaConfigSchema({ timeoutMs: 0 })).toThrow()
  })
  it('selects only declared routes and never silently changes subscriptions', () => {
    expect(selectRoute(config, {}).providerId).toBe('test')
    expect(() => selectRoute({ providers: { a: provider, b: provider } }, {})).toThrow('Multiple')
    expect(() => selectRoute(config, { model: 'missing' })).toThrow('No matching')
    expect(selectRoute({ ...config, provider: 'test', model: 'image2', providers: { ...config.providers, b: { ...provider, models: [{ ...model, id: 'other' }] } } }, { provider: 'b' }).model.id).toBe('other')
  })
  it('rejects invalid API, model, and credential configuration at load', () => {
    expect(() => validateConfig({ providers: { bad: { ...provider, api: 'typo' } } }, ['openai-images'], ['text-to-image'])).toThrow('Unsupported')
    expect(() => validateConfig({ providers: { bad: { ...provider, models: [model, model] } } }, ['openai-images'], ['text-to-image'])).toThrow('Duplicate')
    expect(() => validateConfig({ providers: { bad: { ...provider, anonymous: false } } }, ['openai-images'], ['text-to-image'])).toThrow('apiKeyEnv')
    expect(() => validateConfig({ ...config, provider: 'missing' }, ['openai-images'], ['text-to-image'])).toThrow('does not exist')
  })
  it('keeps credentials and endpoints out of catalogs', () => {
    const value = JSON.stringify(catalog({ providers: { test: { ...provider, apiKeyEnv: 'PRIVATE_MEDIA_KEY' } } }))
    expect(value).not.toContain('PRIVATE_MEDIA_KEY')
    expect(value).not.toContain('provider.example')
  })
  it('bounds streamed response bodies and base64', async () => {
    await expect(readBytes(new Response('12345'), 4)).rejects.toThrow('exceeds')
    await expect(readBytes(new Response('1234'), 4)).resolves.toEqual(Buffer.from('1234'))
    expect(() => decodeBase64('!!!!', 100)).toThrow('Invalid')
    expect(() => decodeBase64('YWJj', 2)).toThrow('oversized')
    expect(decodeBase64('YWJj', 3)).toEqual(Buffer.from('abc'))
  })
  it('refuses arbitrary result hosts and never sends API credentials to downloads', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('abc'))
    vi.stubGlobal('fetch', fetcher)
    const http = await transport(new Context(), selectRoute(config, {}), config, new AbortController().signal)
    await expect(http.download('https://untrusted.example/private-image.png?signature=secret')).rejects.toThrowErrorMatchingInlineSnapshot(`
      [Error: Result download host "untrusted.example" is not trusted for provider "test"; add this exact hostname to provider.downloadHosts]
    `)
    expect(fetcher).not.toHaveBeenCalled()
    await http.download('https://provider.example/image.png?signature=opaque')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
    expect(fetcher.mock.calls[0]?.[1].headers).toBeUndefined()
  })
  it('downloads from an explicitly trusted CDN without trusting lookalike hosts or embedded credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('abc'))
    vi.stubGlobal('fetch', fetcher)
    const config = { providers: { test: { ...provider, downloadHosts: ['cdn.example'] } } }
    const http = await transport(new Context(), selectRoute(config, {}), config, new AbortController().signal)
    await expect(http.download('https://cdn.example.attacker.test/image.png')).rejects.toThrow('not trusted')
    await expect(http.download('https://user:secret@cdn.example/image.png')).rejects.toThrow('without embedded credentials')
    await expect(http.download('ftp://cdn.example/image.png')).rejects.toThrow('HTTP(S)')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(http.download('https://cdn.example/image.png?signature=opaque')).resolves.toEqual(Buffer.from('abc'))
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://cdn.example/image.png?signature=opaque', expect.objectContaining({ redirect: 'error' }))
    expect(fetcher.mock.calls[0]?.[1].headers).toBeUndefined()
  })
  it('reports HTTP status without echoing provider error bodies or keys', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-api-key', { status: 401 })))
    const http = await transport(new Context(), selectRoute(config, {}), config, new AbortController().signal)
    await expect(http.json('/images/generations', {})).rejects.toThrow('HTTP 401')
  })
})
