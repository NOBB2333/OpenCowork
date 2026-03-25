import { nanoid } from 'nanoid'
import { createProvider } from '../../api/provider'
import { runAgentLoop } from '../agent-loop'
import { toolRegistry } from '../tool-registry'
import type { AgentLoopConfig } from '../types'
import type { UnifiedMessage, ProviderConfig, TokenUsage } from '../../api/types'
import type { SubAgentRunConfig, SubAgentResult } from './types'

/**
 * Run a SubAgent — executes an inner agent loop with a focused system prompt
 * and restricted tool set, then returns a consolidated result.
 *
 * SubAgents auto-approve read-only tools. Write tools bubble approval up
 * to the parent via onApprovalNeeded callback.
 */
export async function runSubAgent(config: SubAgentRunConfig): Promise<SubAgentResult> {
  const { definition, parentProvider, toolContext, input, toolUseId, onEvent, onApprovalNeeded } =
    config

  // Create an inner AbortController linked to the parent signal.
  // This allows us to immediately abort inner streams on error/exit,
  // preventing cleanup hangs when ipcStreamRequest is still awaiting data.
  const innerAbort = new AbortController()
  const onParentAbort = (): void => innerAbort.abort()
  toolContext.signal.addEventListener('abort', onParentAbort, { once: true })

  // Emit start event
  onEvent?.({ type: 'sub_agent_start', subAgentName: definition.name, toolUseId, input })

  // 1. Build inner tool definitions (subset of parent's tools + always include Skill)
  const allDefs = toolRegistry.getDefinitions()
  const allowedSet = new Set(definition.allowedTools)
  allowedSet.add('Skill') // All SubAgents get Skill access by default
  const innerTools = allDefs.filter((t) => allowedSet.has(t.name))

  // 2. Build provider config (optionally override model/temperature)
  const innerProvider: ProviderConfig = {
    ...parentProvider,
    systemPrompt: definition.systemPrompt,
    model: definition.model ?? parentProvider.model,
    temperature: definition.temperature ?? parentProvider.temperature
  }

  // 3. Build initial user message from SubAgent input
  const userMessage = formatInputAsMessage(definition.name, input)
  const summaryContextParts: string[] = [`## Task Input\n${userMessage.content}`]

  const systemPrompt = definition.systemPrompt

  // 4. Build inner loop config
  const loopConfig: AgentLoopConfig = {
    maxIterations: definition.maxIterations,
    provider: innerProvider,
    tools: innerTools,
    systemPrompt,
    workingFolder: toolContext.workingFolder,
    signal: innerAbort.signal
  }

  // 6. Run inner agent loop
  let output = ''
  let toolCallCount = 0
  let iterations = 0
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }

  try {
    const loop = runAgentLoop([userMessage], loopConfig, toolContext, async (tc) => {
      // Auto-approve read-only tools
      if (isReadOnly(tc.name)) return true
      // Bubble write tool approval up to parent
      if (onApprovalNeeded) return onApprovalNeeded(tc)
      return false
    })

    for await (const event of loop) {
      if (toolContext.signal.aborted) {
        innerAbort.abort()
        break
      }

      switch (event.type) {
        case 'text_delta':
          output += event.text
          onEvent?.({
            type: 'sub_agent_text_delta',
            subAgentName: definition.name,
            toolUseId,
            text: event.text
          })
          break

        case 'iteration_start':
          iterations = event.iteration
          onEvent?.({
            type: 'sub_agent_iteration',
            subAgentName: definition.name,
            toolUseId,
            iteration: event.iteration
          })
          break

        case 'message_end':
          if (event.usage) {
            totalUsage.inputTokens += event.usage.inputTokens
            totalUsage.outputTokens += event.usage.outputTokens
            if (event.usage.billableInputTokens != null) {
              totalUsage.billableInputTokens =
                (totalUsage.billableInputTokens ?? 0) + event.usage.billableInputTokens
            }
            if (event.usage.cacheCreationTokens) {
              totalUsage.cacheCreationTokens =
                (totalUsage.cacheCreationTokens ?? 0) + event.usage.cacheCreationTokens
            }
            if (event.usage.cacheReadTokens) {
              totalUsage.cacheReadTokens =
                (totalUsage.cacheReadTokens ?? 0) + event.usage.cacheReadTokens
            }
            if (event.usage.reasoningTokens) {
              totalUsage.reasoningTokens =
                (totalUsage.reasoningTokens ?? 0) + event.usage.reasoningTokens
            }
          }
          break

        case 'tool_call_start':
        case 'tool_call_result':
          if (event.type === 'tool_call_result') {
            toolCallCount++
            summaryContextParts.push(formatToolCallSummary(event.toolCall))
          }
          onEvent?.({
            type: 'sub_agent_tool_call',
            subAgentName: definition.name,
            toolUseId,
            toolCall: event.toolCall
          })
          break

        case 'error': {
          // Abort inner streams BEFORE return triggers .return() on the generator.
          // This ensures ipcStreamRequest's waitForItem() resolves immediately,
          // preventing the cleanup chain from hanging up to 30-60s.
          innerAbort.abort()
          const result: SubAgentResult = {
            success: false,
            output: '',
            toolCallCount,
            iterations,
            usage: totalUsage,
            error: event.error.message,
            finalReportMarkdown: await generateFinalMarkdownReport({
              providerConfig: innerProvider,
              toolContext,
              taskInput: String(userMessage.content),
              contextParts: summaryContextParts,
              finalOutput: output,
              status: 'failed',
              error: event.error.message
            })
          }
          onEvent?.({ type: 'sub_agent_end', subAgentName: definition.name, toolUseId, result })
          return result
        }
      }
    }
  } catch (err) {
    innerAbort.abort()
    const errMsg = err instanceof Error ? err.message : String(err)
    const result: SubAgentResult = {
      success: false,
      output: '',
      toolCallCount,
      iterations,
      usage: totalUsage,
      error: errMsg,
      finalReportMarkdown: await generateFinalMarkdownReport({
        providerConfig: innerProvider,
        toolContext,
        taskInput: String(userMessage.content),
        contextParts: summaryContextParts,
        finalOutput: output,
        status: 'failed',
        error: errMsg
      })
    }
    onEvent?.({ type: 'sub_agent_end', subAgentName: definition.name, toolUseId, result })
    return result
  } finally {
    // Ensure inner streams are aborted for all exit paths (including normal completion)
    innerAbort.abort()
    toolContext.signal.removeEventListener('abort', onParentAbort)
  }

  // 7. Format output
  const finalOutput = definition.formatOutput
    ? definition.formatOutput({
        success: true,
        output,
        toolCallCount,
        iterations,
        usage: totalUsage
      })
    : output

  const result: SubAgentResult = {
    success: true,
    output: finalOutput,
    finalReportMarkdown: await generateFinalMarkdownReport({
      providerConfig: innerProvider,
      toolContext,
      taskInput: String(userMessage.content),
      contextParts: summaryContextParts,
      finalOutput,
      status: toolContext.signal.aborted ? 'aborted' : 'completed'
    }),
    toolCallCount,
    iterations,
    usage: totalUsage
  }

  onEvent?.({ type: 'sub_agent_end', subAgentName: definition.name, toolUseId, result })
  return result
}

// --- Helpers ---

const READ_ONLY_SET = new Set(['Read', 'LS', 'Glob', 'Grep', 'TaskList', 'TaskGet', 'Skill'])

function isReadOnly(toolName: string): boolean {
  return READ_ONLY_SET.has(toolName)
}

async function generateFinalMarkdownReport(options: {
  providerConfig: ProviderConfig
  toolContext: SubAgentRunConfig['toolContext']
  taskInput: string
  contextParts: string[]
  finalOutput: string
  status: 'completed' | 'failed' | 'aborted'
  error?: string
}): Promise<string> {
  const { providerConfig, toolContext, taskInput, contextParts, finalOutput, status, error } = options
  const provider = createProvider(providerConfig)
  const prompt = [
    'Produce a professional final task report in Markdown based strictly on the execution evidence provided below.',
    'Do not fabricate actions, files, findings, rationale, risks, or unresolved items.',
    'Write in clear, concise, engineering-oriented English.',
    'Use exactly the following section headings and preserve this order:',
    '# Task Summary',
    '## Objective',
    '## Outcome',
    '## Actions Taken',
    '## Files and Artifacts',
    '## Key Findings',
    '## Decision Rationale',
    '## Risks and Limitations',
    '## Open Questions',
    '## Recommended Next Steps',
    '',
    `Execution Status: ${status}`,
    error ? `Error Detail: ${error}` : '',
    `Original Task Input:\n${taskInput}`,
    contextParts.join('\n\n'),
    `\n## Final Output\n${finalOutput || '(empty)'}`
  ]
    .filter(Boolean)
    .join('\n')

  const messages: UnifiedMessage[] = [
    {
      id: nanoid(),
      role: 'user',
      content: prompt,
      createdAt: Date.now()
    }
  ]

  let report = ''
  try {
    const stream = provider.sendMessage(messages, [], { ...providerConfig }, toolContext.signal)
    for await (const event of stream) {
      if (toolContext.signal.aborted) break
      if (event.type === 'text_delta' && event.text) report += event.text
    }
  } catch {
    report = ''
  }

  if (report.trim()) return report.trim()

  return [
    '# Task Summary',
    '## Objective',
    taskInput,
    '## Outcome',
    status,
    '## Actions Taken',
    finalOutput || '- No execution output was captured.',
    '## Files and Artifacts',
    '- Summary generation failed, so a complete artifact extraction is unavailable.',
    '## Key Findings',
    error ? `- ${error}` : '- No additional findings captured.',
    '## Decision Rationale',
    '- The reporting stage failed, so this fallback summary only reflects minimally available evidence.',
    '## Risks and Limitations',
    '- This report was generated by fallback logic instead of the dedicated reporting pass.',
    '## Open Questions',
    '- Manual review may be required to inspect the detailed execution trace.',
    '## Recommended Next Steps',
    '- Re-run the task or review the execution trace manually if a higher-confidence report is required.'
  ].join('\n')
}

function formatToolCallSummary(toolCall: { name: string; input: Record<string, unknown>; status: string; output?: unknown; error?: string }): string {
  const renderedOutput =
    typeof toolCall.output === 'string'
      ? toolCall.output
      : toolCall.output
        ? JSON.stringify(toolCall.output)
        : ''

  return [
    `## Tool Call: ${toolCall.name}`,
    `- Status: ${toolCall.status}`,
    `- Input: ${JSON.stringify(toolCall.input)}`,
    renderedOutput ? `- Output: ${renderedOutput}` : '',
    toolCall.error ? `- Error: ${toolCall.error}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

function formatInputAsMessage(
  _subAgentName: string,
  input: Record<string, unknown>
): UnifiedMessage {
  // Build a natural language message from the SubAgent input
  const parts: string[] = []

  // Unified Task tool sends "prompt" as the detailed task description
  if (input.prompt) {
    parts.push(String(input.prompt))
  } else if (input.query) {
    parts.push(String(input.query))
  } else if (input.task) {
    parts.push(String(input.task))
  } else if (input.target) {
    parts.push(`Analyze: ${input.target}`)
    if (input.focus) parts.push(`Focus: ${input.focus}`)
  } else {
    // Fallback: stringify the input
    parts.push(JSON.stringify(input, null, 2))
  }

  if (input.scope) {
    parts.push(`\nScope: ${input.scope}`)
  }
  if (input.constraints) {
    parts.push(`\nConstraints: ${input.constraints}`)
  }

  return {
    id: nanoid(),
    role: 'user',
    content: parts.join('\n'),
    createdAt: Date.now()
  }
}
