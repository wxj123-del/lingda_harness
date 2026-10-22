/** Minimal HTML-to-text extraction for web material admitted to a knowledge draft. */

const BLOCK_TAGS = /<\/?(?:p|div|section|article|header|footer|li|ul|ol|h[1-6]|br|tr|table|blockquote|pre)\b[^>]*>/gi
const SCRIPTING = /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const TAG = /<[^>]+>/g
const COMMENTS = /<!--[\s\S]*?-->/g

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return ENTITIES[body.toLowerCase()] ?? match
  })
}

/**
 * Convert an HTML document body to readable plain text.
 *
 * Scripting, styling, and comments are removed before tags so their contents
 * never reach the model. Block-level tags become newlines, then whitespace is
 * collapsed line by line.
 * @param html - raw HTML source.
 * @returns readable plain text without markup.
 */
export function htmlToText(html: string): string {
  const withoutScripting = html.replace(SCRIPTING, ' ').replace(COMMENTS, ' ')
  const withBreaks = withoutScripting.replace(BLOCK_TAGS, '\n')
  const stripped = withBreaks.replace(TAG, ' ')
  return decodeEntities(stripped)
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(line => line !== '')
    .join('\n')
    .trim()
}
