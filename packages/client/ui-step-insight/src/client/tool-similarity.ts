/** Deterministic lexical comparison of request-local user text and tool descriptions. */
import type { InputPart, ToolSimilarity } from './types.ts'

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const stopWords = new Set('a an the to of for and or in on at with from by is are be as this that it its you your i me my can could would should please use using tool tools 一个 一张 一下 请 帮 帮我 我 你 的 了 吗 呢 吧 和 与 或 在 是 把 将 用 使用 需要 可以 能够 怎么 什么'.split(' '))

// Common task terms bridge Chinese requests and English schemas; this is not an embedding model.
const groups = [
  ['image', 'images', 'picture', 'pictures', 'photo', 'photos', '图片', '图像', '照片'],
  ['generate', 'generates', 'generated', 'generating', 'draw', '生成', '绘制', '画'],
  ['audio', 'speech', 'voice', 'tts', '语音', '音频', '朗读'],
  ['video', 'videos', '视频'],
  ['file', 'files', '文件'],
  ['directory', 'directories', 'folder', 'folders', '目录', '文件夹'],
  ['read', 'reads', 'reading', '读取', '阅读'],
  ['write', 'writes', 'writing', '写入'],
  ['edit', 'edits', 'editing', 'modify', '修改', '编辑'],
  ['search', 'searches', 'searching', 'find', '搜索', '检索', '查找'],
  ['web', 'website', 'webpage', '网页', '网站'],
  ['code', 'source', '代码', '源码'],
  ['test', 'tests', 'testing', '测试'],
  ['run', 'execute', 'execution', '运行', '执行'],
  ['command', 'commands', 'shell', 'bash', '命令', '终端'],
  ['download', 'downloads', '下载'],
  ['upload', 'uploads', '上传'],
  ['delete', 'remove', '删除'],
  ['list', 'lists', 'listing', '列出', '列表'],
  ['model', 'models', '模型'],
] as const
const aliases = new Map<string, string>(groups.flatMap(group => group.map(word => [word, group[0]] as const)))

function terms(text: string): Map<string, string> {
  const result = new Map<string, string>()
  const normalized = text.replace(/([a-z\d])([A-Z])/gu, '$1 $2').replace(/[_./-]/gu, ' ').normalize('NFKC').toLowerCase()
  for (const item of segmenter.segment(normalized)) {
    if (!item.isWordLike || stopWords.has(item.segment) || /^\d+$/u.test(item.segment)) continue
    const term = aliases.get(item.segment) ?? item.segment
    if (!result.has(term)) result.set(term, item.segment)
  }
  return result
}

/**
 * Compare tool names/descriptions with user messages already in this request.
 * @param parts - reconstructed input after historical replacements and request cutoff.
 * @param scope - newest user message or all retained user messages.
 * @returns Comparisons in schema order, with inspectable source messages and matched terms.
 */
export function compareTools(parts: readonly InputPart[], scope: 'latest' | 'all'): { sources: InputPart[]; comparisons: ToolSimilarity[] } {
  const users = parts.filter(part => part.kind === 'user')
  const sources = scope === 'latest' ? users.slice(-1) : users
  const query = terms(sources.map(part => part.userText ?? '').join('\n'))
  const schemas = parts.filter(part => part.kind === 'schema')
  const documents = schemas.map(part => ({ part, words: terms(part.schema ? part.schema.name + '\n' + part.schema.description : '') }))
  const frequencies = new Map<string, number>()
  for (const { words } of documents) for (const term of words.keys()) frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
  const weight = (term: string) => 1 + Math.log((documents.length + 1) / ((frequencies.get(term) ?? 0) + 1))
  const norm = (document: Map<string, string>) => Math.sqrt([...document.keys()].reduce((sum, term) => sum + weight(term) ** 2, 0))
  const queryNorm = norm(query)
  const comparisons: ToolSimilarity[] = documents.map(({ part, words: document }) => {
    const matches: ToolSimilarity['matches'] = []
    let dot = 0
    for (const [term, word] of query) {
      const match = document.get(term)
      if (match === undefined) continue
      dot += weight(term) ** 2
      matches.push({ query: word, tool: match })
    }
    const denominator = queryNorm * norm(document)
    return { part, score: denominator === 0 ? null : Math.min(100, Math.round(dot / denominator * 100)), matches }
  })
  return { sources, comparisons }
}
