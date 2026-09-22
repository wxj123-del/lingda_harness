import { describe, expect, it, vi } from 'vitest'
import { parseFeishuEnvelope, parseFeishuMessage } from '../src/parser.ts'
import { executeFeishuControlCommand, resolveFeishuControlCommand } from '../src/control-command.ts'

describe('Feishu payload parser', () => {
  it('parses text messages from v2 event envelopes', () => {
    const message = parseFeishuMessage(parseFeishuEnvelope(JSON.stringify({
      header: { event_type: 'im.message.receive_v1', event_id: 'evt-1', app_id: 'cli_x' },
      event: {
        sender: { sender_id: { open_id: 'ou_1' } },
        message: {
          message_id: 'om_1', message_type: 'text', chat_type: 'p2p', chat_id: 'oc_1',
          content: JSON.stringify({ text: ' hello ' }),
        },
      },
    })))
    expect(message).toMatchObject({ eventId: 'evt-1', openId: 'ou_1', chatId: 'oc_1', text: 'hello' })
  })

  it('ignores non-message and non-text events', () => {
    expect(parseFeishuMessage({ header: { event_type: 'app.ticket' }, event: {} })).toBeNull()
    expect(parseFeishuMessage({ header: { event_type: 'im.message.receive_v1' }, event: { message: { message_type: 'image' } } })).toBeNull()
  })
})

describe('Feishu control command resolver', () => {
  it.each([
    ['/mode qa', '/mode qa'],
    ['/compact', '/compact'],
    ['现在是什么模式', '/mode'],
    ['改为编码模式', '/mode coding'],
    ['切换到CODING模式', '/mode coding'],
    ['切换到研究模式', '/mode research'],
    ['进入执行模式', '/mode execution'],
  ] as const)('consumes %j without model routing', (input, expected) => {
    expect(resolveFeishuControlCommand(input)).toBe(expected)
  })

  it.each(['帮我修改这个文件', '请解释一下上下文路由', '改为蓝色模式'])('keeps ordinary text model-visible: %j', (input) => {
    expect(resolveFeishuControlCommand(input)).toBeUndefined()
  })

  it('executes a command without an Agent follow-up', async () => {
    const execute = vi.fn(async (_line: string) => ({ kind: 'success' as const, text: '已切换' }))
    const result = await executeFeishuControlCommand(
      { execute: async (_agent, line, _attachments, _signal) => ({ commandId: 'command' as never, result: await execute(line) }) },
      { id: 'agent', session: {} } as never,
      '/mode qa',
      new AbortController().signal,
    )
    expect(result).toEqual({ handled: true, text: '已切换' })
    expect(execute).toHaveBeenCalledWith('/mode qa')
  })
})
