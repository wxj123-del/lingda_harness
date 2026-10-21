/**
 * The answer-body density rules as CSS text. jsdom has no layout, so the
 * rendering specs cannot show whether a long code block pushes the rest of the
 * answer off-screen or which clause wins for a wide table; these read the
 * declarations that keep both inside the message column.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')

function declarationsFrom(source: string, selector: string): string[] {
  const declarationText = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rule = new RegExp(`(?:^|[{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('answer body density', () => {
  it('caps a fenced code block at its own scrollport instead of growing with the answer', () => {
    // The banner is the block's sibling above the content node, so capping the
    // <pre> keeps Copy reachable while the source scrolls under it.
    expect(declarationsFrom(read('ui-primitives/src/markdown/CodeBlock.module.css'), '.block :where(pre)'))
      .toEqual(expect.arrayContaining([
        'max-height: var(--dsl-code-block-max-height, min(420px, 60vh))',
        'overflow-y: auto',
      ]))
  })

  it('lets a host that already owns the viewport opt out of the code cap', () => {
    // The sidebar file preview scrolls its own content node; a second nested
    // scrollport there would double the scrollbars for one file.
    expect(declarationsFrom(read('ui-sidebar-documentpreview/src/client/code/CodeBody.module.css'), '.renderer .code'))
      .toEqual(expect.arrayContaining(['--dsl-code-block-max-height: none']))
  })

  it('keeps a wide table inside the message column instead of widening the transcript', () => {
    // The breakout was a rule that negated the wrapper's max-width with a
    // 100cqw-derived negative margin. Comments may still name the hook; no
    // declaration may reintroduce either half of the breakout.
    const css = read('ui-chat/src/client/chat/AssistantMarkdown.module.css')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
    expect(css).not.toContain('--dsh-table-lead')
    expect(css).not.toContain('100cqw')
    expect(css).not.toMatch(/width:\s*calc\(100%\s*\+/)
  })

  it('reads the wide table as an in-column horizontal scroll on hover and focus', () => {
    const css = read('ui-primitives/src/markdown/MarkdownText.module.css')
    expect(declarationsFrom(css, '.tableScroll')).toEqual(expect.arrayContaining([
      'max-width: 100%',
      'overflow-x: auto',
    ]))
    // Hover and focus share one declaration block behind a selector list, so
    // this reads the block itself rather than one selector of the list.
    const reveal = /\.tableScroll:global\(\.md-table-wide\):hover[\s\S]*?\{([^}]*)\}/.exec(css)
    if (reveal === null) throw new Error('no wide-table hover rule')
    expect((reveal[1] ?? '').replace(/\s+/g, ' ').trim()).toContain('overflow-x: scroll')
  })
})
