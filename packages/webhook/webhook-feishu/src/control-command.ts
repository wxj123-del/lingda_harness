import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandExecution, CommandRuntime } from '@deepseek-ai/dsh-commands'
import { parseCommand } from '@deepseek-ai/dsh-commands'

const MODE_NAMES: Readonly<Record<string, string>> = {
  qa: 'qa',
  research: 'research',
  coding: 'coding',
  execution: 'execution',
  问答: 'qa',
  研究: 'research',
  调研: 'research',
  编码: 'coding',
  开发: 'coding',
  执行: 'execution',
}

/**
 * Resolve a Feishu line that must bypass the model into a command line.
 *
 * Slash commands keep their original spelling. A small set of unambiguous
 * Chinese mode phrases is mapped to the existing `/mode` command so mobile
 * users do not need to know the command syntax. Ordinary text returns
 * `undefined` and continues through the Agent loop.
 *
 * @param input - Feishu text message.
 * @returns A command line to execute directly, or `undefined` for model text.
 */
export function resolveFeishuControlCommand(input: string): string | undefined {
  const text = input.trim()
  if (parseCommand(text) !== undefined) return text
  if (/^(?:现在|当前)(?:是)?什么(?:工作)?模式[?？。！!]?$/u.test(text)) return '/mode'
  const match = /^(?:改为|切换到|切换为|进入)\s*(qa|research|coding|execution|问答|研究|调研|编码|开发|执行)(?:模式)?[?？。！!]?$/iu.exec(text)
  const value = match?.[1]
  if (value === undefined) return undefined
  const mode = MODE_NAMES[value.toLocaleLowerCase()]
  return mode === undefined ? undefined : `/mode ${mode}`
}

/** Result of handling one Feishu message before the Agent loop. */
export interface FeishuControlCommandResult {
  handled: boolean
  text?: string
}

/**
 * Execute a recognized Feishu control command without enqueueing a model turn.
 *
 * @param commands - Command registry used by the active deployment.
 * @param agent - Agent receiving the command.
 * @param input - Original Feishu message text.
 * @param signal - Cancellation signal owned by the adapter dispatch.
 * @returns Whether the input was consumed and optional direct reply text.
 */
export async function executeFeishuControlCommand(
  commands: Pick<CommandRuntime, 'execute'>,
  agent: Agent,
  input: string,
  signal: AbortSignal,
): Promise<FeishuControlCommandResult> {
  const commandLine = resolveFeishuControlCommand(input)
  if (commandLine === undefined) return { handled: false }
  const execution: CommandExecution | undefined = await commands.execute(agent, commandLine, [], signal)
  const text = execution?.result.text
    ?? (execution === undefined ? `未知命令：${commandLine}` : undefined)
  return {
    handled: true,
    ...(text === undefined ? {} : { text }),
  }
}
