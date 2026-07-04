import type { ToolName, ToolResult } from '../types.js'

const RETRYABLE_TOOLS: Set<ToolName> = new Set([
  'read_file',
  'read_multiple_files',
  'preview_spreadsheet',
  'inspect_file',
  'list_mcp_tools',
  'call_mcp_tool',
  'write_file',
  'write_markdown_report',
  'write_json_result',
  'execute_python',
])

const TOOL_FALLBACKS: Partial<Record<ToolName, ToolName>> = {
  'preview_spreadsheet': 'inspect_file',
}

interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND/.test(message) ||
    /timeout|timed out/i.test(message) ||
    /rate.?limit|429|503|502/i.test(message) ||
    /MCP stderr/i.test(message)
  )
}

export async function executeToolWithRetry(
  tool: ToolName,
  input: Record<string, unknown>,
  executor: (tool: ToolName, input: Record<string, unknown>) => Promise<ToolResult>,
  options: RetryOptions = {},
): Promise<ToolResult> {
  const maxRetries = options.maxRetries ?? 2
  const baseDelay = options.baseDelayMs ?? 800

  if (!RETRYABLE_TOOLS.has(tool)) {
    return executor(tool, input)
  }

  let lastResult: ToolResult | undefined
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await executor(tool, input)

      if (result.success !== false) {
        return result
      }

      lastResult = result

      if (!isTransientError(result.error)) {
        break
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (!isTransientError(error)) {
        break
      }
    }

    if (attempt < maxRetries) {
      await sleep(baseDelay * Math.pow(2, attempt))
    }
  }

  const fallbackTool = TOOL_FALLBACKS[tool]
  if (fallbackTool) {
    try {
      const fallbackResult = await executor(fallbackTool, input)
      if (fallbackResult.success !== false) {
        return {
          ...fallbackResult,
          summary: `[降级使用 ${fallbackTool}] ${fallbackResult.summary}`,
        }
      }
    } catch {
      // fallback also failed, return original error
    }
  }

  if (lastResult) return lastResult

  return {
    summary: `工具 ${tool} 执行失败: ${lastError?.message || '未知错误'}`,
    success: false,
    error: lastError?.message || 'execution_failed',
  }
}

export async function requestDecisionWithFallback(
  primaryRequest: () => Promise<{ tool: ToolName; input: Record<string, unknown>; reasoning: string }>,
  fallbackDecision: () => { tool: ToolName; input: Record<string, unknown>; reasoning: string },
  options: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<{ tool: ToolName; input: Record<string, unknown>; reasoning: string }> {
  const maxRetries = options.maxRetries ?? 1
  const baseDelay = options.baseDelayMs ?? 2000

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await primaryRequest()
    } catch (error) {
      if (attempt < maxRetries && isTransientError(error)) {
        await sleep(baseDelay * Math.pow(2, attempt))
        continue
      }

      if (!isTransientError(error)) {
        break
      }
    }
  }

  const fb = fallbackDecision()
  return {
    ...fb,
    reasoning: `[LM 决策失败，使用兜底策略] ${fb.reasoning}`,
  }
}
