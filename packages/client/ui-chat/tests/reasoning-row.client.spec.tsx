// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'

afterEach(() => {
  cleanup()
})

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null
const reasoning = (text: string) => ({ kind: 'reasoning' as const, text })

describe('transcript reasoning', () => {
  it('never paints settled reasoning prose into the transcript', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[reasoning('Inspect the session\nCheck persistence'), { kind: 'text', text: 'Answer' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )

    expect(view.queryByText(/Inspect the session/)).toBeNull()
    expect(view.queryByText(/Check persistence/)).toBeNull()
    expect(view.queryByText('思考')).toBeNull()
    expect(view.getByText('Answer')).toBeTruthy()
  })

  it('shows a content-free live row while the reasoning tail streams', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[reasoning('**Comparing checkout and merge bases**')]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )

    expect(view.getByText('思考')).toBeTruthy()
    expect(view.getByText('运行中')).toBeTruthy()
    // Liveness only: no prose, no asterisk-stripped summary, nothing to expand.
    expect(view.queryByText(/Comparing checkout/)).toBeNull()
    expect(view.queryByRole('button')).toBeNull()
    expect(view.container.querySelector('[data-variant="think"]')?.getAttribute('data-state'))
      .toBe('running')
  })

  it('drops the live row once the next block arrives or the step settles', () => {
    const blocks = [reasoning('Inspect the session')]
    const view = render(
      <AssistantMarkdown t={t} blocks={blocks} streaming renderMessageImages={renderMessageImages} />,
    )
    expect(view.getByText('思考')).toBeTruthy()

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[...blocks, { kind: 'text', text: 'Answer' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.queryByText('思考')).toBeNull()

    view.rerender(
      <AssistantMarkdown t={t} blocks={blocks} streaming={false} renderMessageImages={renderMessageImages} />,
    )
    expect(view.queryByText('思考')).toBeNull()
    expect(view.queryByText(/Inspect the session/)).toBeNull()
  })

  it('keeps an interrupted partial from painting its reasoning', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[reasoning('bad path')]}
        streaming={false}
        interrupted
        renderMessageImages={renderMessageImages}
      />,
    )

    expect(view.queryByText(/bad path/)).toBeNull()
    expect(view.getByText('已停止')).toBeTruthy()
  })
})
