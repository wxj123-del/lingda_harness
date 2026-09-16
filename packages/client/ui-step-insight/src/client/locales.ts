/** Product copy for the Token ledger and its accounting distinctions. */
export const NS = 'stepInsight'

/** Simplified Chinese ledger copy. */
export const zh = {
  title: 'Token 轨迹', search: '搜索步骤、模型或工具', export: '导出已加载记录',
  total: '已知总用量', input: '输入', output: '输出', cache: '缓存读取',
  cacheWrite: '缓存写入', uncached: '未缓存输入', reasoning: '思考（包含在输出中）',
  unknownInput: '未分类输入', requests: '请求', step: '步骤', turn: '轮', attempt: '次',
  compaction: '上下文压缩', betweenTurns: '轮次之间', model: '模型', duration: '耗时',
  all: '全部状态', missing: '用量未完整上报', errors: '失败 / 中断',
  chronological: '按时间', expensive: '按 Token 降序', sort: '排序', filter: '筛选状态',
  reported: '供应商上报', unreported: '未上报', estimated: '估算', pending: '等待用量',
  waiting: '等待中', streaming: '生成中', complete: '完成', interrupted: '中断',
  error: '失败', attemptStatus: '未提交的尝试',
  inputTab: '输入溯源', outputTab: '输出明细', toolsTab: '工具调用', rawTab: '原始记录',
  system: '系统提示词', schema: '工具定义', user: '用户消息', context: '插件 / 技能上下文',
  assistant: '历史模型输出', tool: '工具结果', unknown: '其他内容',
  token: 'Token', event: '事件', source: '来源', arguments: '调用参数', result: '返回结果',
  answer: '回答', thinking: '思考', toolCall: '工具调用参数', other: '其他输出',
  sourceEstimate: '内容项为字符估算，不是分项账单；不与供应商用量重复相加。',
  mediaEstimate: '含图片或附件；视觉与文件转换用量未计入文本估算。',
  partialHistory: '仅汇总已加载记录，较早的请求尚未计入。',
  partialInput: '输入来源不完整，加载更早记录后可继续追溯。',
  customProjection: '部分插件内容需要自定义消息投影，当前无法还原。',
  compactionInput: '压缩请求的专用输入未完整记录，不能由普通对话输入推断。',
  toolAccounting: '工具执行本身不额外消耗模型 Token；参数属于模型输出，返回结果在后续请求中计入输入。',
  subtool: '程序内部调用，结果不直接进入模型上下文',
  liveEstimate: '生成内容实时估算；实际用量等待供应商返回。',
  loaded: '已加载请求', incomplete: '用量不完整的请求',
  loadOlder: '加载更早记录', loading: '加载中', more: '显示更多请求',
  empty: '尚无模型请求', noMatches: '没有匹配的请求', noInput: '没有可还原的输入内容',
  noOutput: '尚无输出内容', noTools: '本次请求没有工具调用',
  select: '查看请求明细', firstToken: '首 Token 延迟', throughput: '输出 Token / 秒',
  cacheRate: '缓存命中率', cumulative: '累计已知 Token', delta: '较上次输入',
  accounting: '供应商用量', content: '内容来源', rawUsage: '原始用量字段',
  exportError: '导出失败，请重试', loadError: '历史记录加载失败，请重试',
  pageSize: '当前显示', textEstimate: '文本估算', milliseconds: 'ms',
  lowerBound: '≥ 表示已上报字段的小计；缺失字段保持未知，完整总量可能更高。',
  toolSimilarity: '工具与对话相似度', similarity: '相似度',
  similarityMethod: '本地词项相关度估算，含常见中英任务词映射；不调用模型、不消耗额外 Token，不代表语义理解或模型调用概率。',
  comparisonScope: '对话范围', latestUser: '最新用户消息', allUsers: '请求内全部用户消息',
  toolOrder: '工具排序', schemaOrder: '原始顺序', similarityOrder: '相似度降序',
  comparisonText: '参照文本与计算依据', noComparisonText: '没有可比较的用户文本',
  called: '本步已调用', notComparable: '无法比较', matchedTerms: '匹配词', noMatchingTerms: '没有匹配词',
} as const

/** Keys owned by this plugin's locale namespace. */
export type StepInsightKey = keyof typeof zh
/** A translator already bound to the ledger namespace. */
export type Translate = (key: StepInsightKey) => string

/** English ledger copy with the same keys as Chinese. */
export const en: Record<StepInsightKey, string> = {
  title: 'Token trace', search: 'Search steps, models or tools', export: 'Export loaded records',
  total: 'Known total', input: 'Input', output: 'Output', cache: 'Cache read',
  cacheWrite: 'Cache write', uncached: 'Uncached input', reasoning: 'Reasoning (included in output)',
  unknownInput: 'Unclassified input', requests: 'Requests', step: 'Step', turn: 'Turn', attempt: 'Attempt',
  compaction: 'Context compaction', betweenTurns: 'Between turns', model: 'Model', duration: 'Duration',
  all: 'All states', missing: 'Incomplete usage', errors: 'Failed / interrupted',
  chronological: 'Chronological', expensive: 'Most tokens first', sort: 'Sort', filter: 'Filter status',
  reported: 'Provider reported', unreported: 'Not reported', estimated: 'Estimate', pending: 'Awaiting usage',
  waiting: 'Waiting', streaming: 'Streaming', complete: 'Complete', interrupted: 'Interrupted',
  error: 'Failed', attemptStatus: 'Uncommitted attempt',
  inputTab: 'Input sources', outputTab: 'Output details', toolsTab: 'Tool calls', rawTab: 'Source records',
  system: 'System prompt', schema: 'Tool schema', user: 'User message', context: 'Plugin / skill context',
  assistant: 'Prior model output', tool: 'Tool result', unknown: 'Other content',
  token: 'Tokens', event: 'Event', source: 'Source', arguments: 'Call arguments', result: 'Result',
  answer: 'Answer', thinking: 'Reasoning', toolCall: 'Tool call arguments', other: 'Other output',
  sourceEstimate: 'Content sizes are character estimates, not itemized billing; they are not added to provider usage.',
  mediaEstimate: 'Contains media; visual tokens and file conversion are excluded from text estimates.',
  partialHistory: 'Totals cover loaded records only. Earlier requests are not included.',
  partialInput: 'Input sources are incomplete. Load earlier records to trace further.',
  customProjection: 'Some plugin content requires a custom message projection and cannot be reconstructed here.',
  compactionInput: 'The dedicated compaction prompt was not fully recorded; ordinary chat input cannot reconstruct it.',
  toolAccounting: 'Tool execution is not an extra model token charge. Arguments belong to output; returned results enter later input.',
  subtool: 'Internal program call; its result does not directly enter model context',
  liveEstimate: 'Live text estimate; actual usage awaits the provider.',
  loaded: 'Loaded requests', incomplete: 'Requests with incomplete usage',
  loadOlder: 'Load earlier records', loading: 'Loading', more: 'Show more requests',
  empty: 'No model requests yet', noMatches: 'No matching requests', noInput: 'No recoverable input content',
  noOutput: 'No output yet', noTools: 'No tool calls in this request',
  select: 'Inspect request', firstToken: 'Time to first token', throughput: 'Output tokens / second',
  cacheRate: 'Cache hit rate', cumulative: 'Cumulative known tokens', delta: 'Input change',
  accounting: 'Provider usage', content: 'Content sources', rawUsage: 'Raw usage fields',
  exportError: 'Export failed; retry', loadError: 'History loading failed; retry',
  pageSize: 'Currently showing', textEstimate: 'Text estimate', milliseconds: 'ms',
  lowerBound: '≥ marks the sum of reported fields; missing fields remain unknown and the complete total may be higher.',
  toolSimilarity: 'Tool / conversation similarity', similarity: 'Similarity',
  similarityMethod: 'Local lexical estimate with common Chinese/English task aliases. No model calls or extra tokens; not semantic understanding or a tool-call probability.',
  comparisonScope: 'Conversation scope', latestUser: 'Latest user message', allUsers: 'All user messages in request',
  toolOrder: 'Tool order', schemaOrder: 'Original order', similarityOrder: 'Highest similarity first',
  comparisonText: 'Reference text and scoring basis', noComparisonText: 'No comparable user text',
  called: 'Called in this step', notComparable: 'Not comparable', matchedTerms: 'Matched terms', noMatchingTerms: 'No matching terms',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    stepInsight: StepInsightKey
  }
}
