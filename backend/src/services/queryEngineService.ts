import path from 'node:path'
import fs from 'node:fs/promises'
import { decodePossibleMojibake, safeJoin, ensureDirWithMcp } from '../fsUtils.js'
import { executePythonInSandbox } from './pythonSandbox.js'
import type {
  AgentContextRecord,
  AgentExecutionResult,
  ClarificationRequest,
  ContextPack,
  DeepSeekConfig,
  DeepSeekToolDefinition,
  DeliverablePlan,
  ExecutionLog,
  QueryRequest,
  SessionRecord,
  SkillRecord,
  TaskState,
  TaskUnderstanding,
  ToolCallRecord,
  ToolDecision,
  ToolName,
  ToolResult,
  WorkspaceFilePreview,
  WorkspaceSnapshot,
  WorkflowStep,
} from '../types.js'
import { loadDeepSeekConfig } from '../fsUtils.js'
import { requestToolDecision, understandTask } from './deepseekService.js'
import { callMcpTool, listMcpTools } from './mcpService.js'
import { getSession, findWorkspaceFilePath, updateSessionStatus } from './sessionService.js'
import { bumpSkillUsage, matchSkills } from './skillService.js'
import { executeToolWithRetry } from './retryService.js'
import { checkTokenBudget, getSessionTokenUsage } from './tokenUsageService.js'
import { validateOutputQuality } from './outputQualityService.js'
import { inspectFile, previewSpreadsheet } from './spreadsheetService.js'
import { 
  detectWordFormat, 
  extractWordStructure, 
  extractWordText,
  type WordBlock 
} from './word/index.js'

/** 低于此得分的技能匹配视为噪声（要求关键词+文件类型双命中，避免弱信号误选） */
const SKILL_MATCH_MIN_SCORE = 5

const TOOL_DEFINITIONS: DeepSeekToolDefinition[] = [
  {
    name: 'observe_workspace',
    description: '观察当前工作区和输出区文件情况，适合任务开始时建立上下文。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_workspace_tree',
    description: '列出工作区树状结构，适合先了解有哪些文件与目录。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'inspect_file',
    description: '理解单个文件的格式、结构、可执行性与建议操作。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '工作区中的相对文件名' },
      },
      required: ['target'],
    },
  },
  {
    name: 'read_file',
    description: '读取工作区中的单个文件内容；文本支持局部截断读取，Word 支持按 blockId、blockType、offset、limit 精读段落块和表格块。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '工作区中的相对文件名' },
        offset: { type: 'number', description: '从第几行开始读取，适用于文本文件；对 Word 表示从第几个块开始' },
        limit: { type: 'number', description: '最多读取多少行，适用于文本文件；对 Word 表示最多读取多少个块' },
        blockIds: { type: 'array', items: { type: 'string' }, description: '仅读取指定 Word block id，例如 ["p-3", "t-1"]' },
        blockType: { type: 'string', enum: ['paragraph', 'table'], description: '仅读取指定类型的 Word 块' },
      },
      required: ['target'],
    },
  },
  {
    name: 'read_multiple_files',
    description: '一次读取多个工作区文本文件，用于对比、汇总、批量分析。',
    inputSchema: {
      type: 'object',
      properties: {
        targets: { type: 'array', items: { type: 'string' } },
      },
      required: ['targets'],
    },
  },
  {
    name: 'preview_spreadsheet',
    description: '预览 Excel 工作表、表头和样例数据，用于理解表格结构。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '工作区中的 Excel 文件名' },
      },
      required: ['target'],
    },
  },
  {
    name: 'execute_python',
    description: '执行 Python 脚本对 Excel/CSV 进行修改操作（删列、改值、筛选、排序、合并等）。脚本中可用 openpyxl、pandas 等库。环境变量 WORKSPACE_PATH 和 OUTPUT_PATH 可获取会话路径。简单任务一步到位。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python 代码，可使用 os.environ["WORKSPACE_PATH"] 和 os.environ["OUTPUT_PATH"] 访问会话目录' },
        description: { type: 'string', description: '简要说明脚本目的，用于日志' },
      },
      required: ['code'],
    },
  },
  {
    name: 'write_file',
    description: '将普通文本结果写入 output 目录。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['target', 'content'],
    },
  },
  {
    name: 'write_markdown_report',
    description: '将分析、总结、计划写成 markdown 报告输出到 output 目录。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        title: { type: 'string' },
        sections: { type: 'array', items: { type: 'string' } },
      },
      required: ['target', 'title', 'sections'],
    },
  },
  {
    name: 'write_json_result',
    description: '将结构化结果写成 json 文件输出到 output 目录。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        payload: { type: 'object', additionalProperties: true },
      },
      required: ['target', 'payload'],
    },
  },
  {
    name: 'copy_workspace_file_to_output',
    description: '将工作区内文件复制到 output，方便留存或交付。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        target: { type: 'string' },
      },
      required: ['source', 'target'],
    },
  },
  {
    name: 'list_mcp_tools',
    description: '查看指定 MCP 服务暴露的工具，适合在第一次接入 MCP 时先探测能力。',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'MCP 服务配置 id，例如 filesystem' },
      },
      required: ['serverId'],
    },
  },
  {
    name: 'call_mcp_tool',
    description: '调用指定 MCP 服务中的某个工具，并返回执行结果。',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'MCP 服务配置 id，例如 filesystem' },
        toolName: { type: 'string', description: 'MCP 工具名' },
        arguments: { type: 'object', additionalProperties: true },
      },
      required: ['serverId', 'toolName'],
    },
  },
  {
    name: 'end_turn',
    description: '当本轮任务已经完成或达到可交付状态时结束。finalAnswer 必须是面向用户的完整总结，包含：做了什么、生成了哪些文件、用户接下来可以做什么。',
    inputSchema: {
      type: 'object',
      properties: {
        finalAnswer: { type: 'string', description: '面向用户的完整任务总结。必须包含：1）完成了什么操作；2）生成了哪些文件（文件名）；3）简要说明结果内容。不要只写"任务结束"或"已完成"。' },
      },
      required: ['finalAnswer'],
    },
  },
]

export async function runQueryEngine(request: QueryRequest): Promise<AgentExecutionResult> {
  const session = await getRequiredSession(request.sessionId)
  const config = await loadDeepSeekConfig()
  const maxTurns = Math.min(request.maxTurns ?? config.maxTurns ?? 30, 100)
  const logs: ExecutionLog[] = []
  const workflowSteps: WorkflowStep[] = []
  const contextRecords: AgentContextRecord[] = [...session.contextRecords]
  const toolCalls: ToolCallRecord[] = []

  let assistantMessage = ''
  let stopReason: AgentExecutionResult['stopReason'] = 'max_turns'
  let currentStage = session.taskStage || inferInitialStage(session)
  let consecutiveEndTurnCount = 0
  let consecutiveModelFailures = 0
  const MAX_CONSECUTIVE_END_TURNS = 3
  const MAX_CONSECUTIVE_MODEL_FAILURES = 2

  pushLog(logs, 'query-engine', 'info', '接收用户问题，进入 QueryEngine')

  const initialSnapshot = await observeWorkspace(session)

  // === 理解环节：把模糊指令 + 文件清单补全为结构化任务单，驱动后续技能匹配与执行 ===
  pushLog(logs, 'query-engine', 'info', '进入任务理解环节，正在补全并明确任务目标')
  const understanding = await understandTask({
    config,
    userInput: request.userInput,
    snapshot: initialSnapshot,
    conversationHistory: session.messages,
    sessionId: request.sessionId,
    userId: request.userId,
  })
  pushLog(
    logs,
    'query-engine',
    'info',
    `任务理解完成：${understanding.goal}（置信度 ${understanding.confidence.toFixed(2)}${understanding.llmGenerated ? '' : '，规则降级'}）`,
  )
  if (understanding.intentKeywords.length) {
    pushLog(logs, 'query-engine', 'info', `补全意图关键词：${understanding.intentKeywords.join('、')}`)
  }
  if (understanding.missingInfo.length) {
    pushLog(logs, 'query-engine', 'info', `理解阶段发现缺失信息：${understanding.missingInfo.join('；')}`)
  }

  const skillMatches = await matchSkills(request.userInput, initialSnapshot, understanding)
  const selectedSkill: SkillRecord | undefined = skillMatches.length > 0 && skillMatches[0].score >= SKILL_MATCH_MIN_SCORE
    ? skillMatches[0].skill
    : undefined
  let skillContent: string | null = null
  if (selectedSkill) {
    const { loadSkillContent } = await import('./skillService.js')
    skillContent = await loadSkillContent(selectedSkill.id)
    pushLog(logs, 'query-engine', 'info', `匹配技能：${selectedSkill.name}（得分 ${skillMatches[0].score.toFixed(1)}）`)
  } else {
    pushLog(logs, 'query-engine', 'info', '未匹配到高置信技能，将按通用流程执行')
  }

  const initialFocusFile = request.focusFile && initialSnapshot.workspaceFiles.some(file => file.name === request.focusFile)
    ? request.focusFile
    : undefined
  const contextPack = await buildContextPack(request.userInput, session, initialSnapshot)
  const deliverablePlan = buildDeliverablePlan(request.userInput, session, initialSnapshot, selectedSkill, understanding)
  let taskState = buildTaskState(session, contextPack.recommendedStage || currentStage, initialSnapshot, deliverablePlan, selectedSkill, contextPack)
  taskState = { ...taskState, understanding }
  // 理解环节明确了目标文件时，优先把它们置于选定输入前列
  if (understanding.targetFiles.length) {
    const prioritized = [
      ...understanding.targetFiles,
      ...taskState.selectedInputs.filter(name => !understanding.targetFiles.includes(name)),
    ]
    taskState = { ...taskState, selectedInputs: prioritized }
  }
  if (initialFocusFile) {
    taskState = {
      ...taskState,
      selectedInputs: [initialFocusFile, ...taskState.selectedInputs.filter(name => name !== initialFocusFile)],
    }
  }
  currentStage = contextPack.recommendedStage || currentStage
  await updateSessionStatus(request.sessionId, 'executing', {
    stopRequested: false,
    taskStage: currentStage,
    deliverablePlan,
    taskState,
  })
  await ensureTaskPlan(session, request.userInput, deliverablePlan)

  let prevWorkspaceFingerprint = ''

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const latestSession = await getRequiredSession(request.sessionId)
    currentStage = latestSession.taskStage || currentStage
    const activeDeliverablePlan = latestSession.deliverablePlan || deliverablePlan
    if (latestSession.stopRequested) {
      stopReason = 'stopped'
      assistantMessage = '任务已停止。'
      pushLog(logs, 'agent-loop', 'error', `第 ${turn} 轮检测到停止请求，终止执行`)
      workflowSteps.push({ module: `Agent Loop ${turn}`, status: 'error', output: '用户请求停止执行' })
      break
    }

    // Token budget enforcement (checks both session and daily budgets)
    const budget = await checkTokenBudget({ sessionId: request.sessionId, userId: request.userId })
    if (!budget.allowed) {
      stopReason = 'max_turns'
      assistantMessage = `已达到 token 预算上限：${budget.reason}。请开启新会话继续，或联系管理员提升配额。`
      pushLog(logs, 'agent-loop', 'error', `第 ${turn} 轮触发预算保护：${budget.reason}`)
      workflowSteps.push({
        module: `Agent Loop ${turn}`,
        status: 'error',
        output: assistantMessage,
      })
      break
    }
    if (turn === 1 || turn % 5 === 0) {
      const usedInSession = await getSessionTokenUsage(request.sessionId)
      pushLog(logs, 'agent-loop', 'info', `第 ${turn} 轮：会话累计 ${usedInSession} tokens（预算 ${budget.sessionBudget}）`)
    }

    const snapshot = await observeWorkspace(latestSession)
    const activeFocusFile = request.focusFile && snapshot.workspaceFiles.some(file => file.name === request.focusFile)
      ? request.focusFile
      : undefined
    const wsFingerprint = snapshot.workspaceFiles.map(f => `${f.name}:${f.size}`).join('|')
    const workspaceChanged = wsFingerprint !== prevWorkspaceFingerprint
    prevWorkspaceFingerprint = wsFingerprint
    const refreshedContextPack = workspaceChanged
      ? await buildContextPack(request.userInput, latestSession, snapshot)
      : contextPack
    if (activeFocusFile && !refreshedContextPack.pinnedFiles.includes(activeFocusFile)) {
      refreshedContextPack.pinnedFiles = [activeFocusFile, ...refreshedContextPack.pinnedFiles]
      const focusedCandidate = refreshedContextPack.candidateInputs.find(file => file.name === activeFocusFile)
      if (focusedCandidate) {
        refreshedContextPack.candidateInputs = [focusedCandidate, ...refreshedContextPack.candidateInputs.filter(file => file.name !== activeFocusFile)]
      }
    }
    const refreshedDeliverablePlan = refreshDeliverablePlan(activeDeliverablePlan, snapshot)
    taskState = updateTaskState(taskState, currentStage, snapshot, refreshedDeliverablePlan, selectedSkill, toolCalls, undefined, undefined, refreshedContextPack)
    const clarificationRequest = maybeRequireClarification(latestSession, request.userInput, snapshot, refreshedDeliverablePlan, taskState, selectedSkill)
    if (clarificationRequest) {
      stopReason = 'clarification_required'
      assistantMessage = clarificationRequest.question
      taskState = {
        ...taskState,
        blockers: [...new Set([...(taskState.blockers || []), clarificationRequest.reason])],
        pendingClarification: clarificationRequest,
      }
      await updateSessionStatus(request.sessionId, 'awaiting_clarification', {
        stopRequested: false,
        taskStage: currentStage,
        deliverablePlan: refreshedDeliverablePlan,
        taskState,
      })
      workflowSteps.push({
        module: `Agent Loop ${turn}`,
        status: 'completed',
        output: `需要用户澄清：${clarificationRequest.question}`,
      })
      pushLog(logs, 'clarification', 'info', `触发用户澄清：${clarificationRequest.reason}`)
      break
    }
    let decision: ToolDecision
    try {
      decision = await decideNextTool({
        turn,
        maxTurns,
        userInput: request.userInput,
        snapshot,
        contextPack: refreshedContextPack,
        currentStage,
        messages: latestSession.messages,
        deliverablePlan: refreshedDeliverablePlan,
        selectedSkill,
        skillContent,
        taskState,
        clarificationPolicy: latestSession.clarificationPolicy,
        contextRecords,
        toolCalls,
        sessionId: request.sessionId,
        userId: request.userId,
        understanding,
      })
      consecutiveModelFailures = 0
    } catch (error) {
      consecutiveModelFailures++
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      
      if (consecutiveModelFailures >= MAX_CONSECUTIVE_MODEL_FAILURES) {
        stopReason = 'max_turns'
        assistantMessage = `模型调用连续失败 ${consecutiveModelFailures} 次，最后错误：${errorMessage}。请检查 API 配置、余额或网络连接后重试。`
        pushLog(logs, 'agent-loop', 'error', `第 ${turn} 轮模型调用失败达到上限，终止执行`)
        workflowSteps.push({
          module: `Agent Loop ${turn}`,
          status: 'error',
          output: assistantMessage,
        })
        break
      }
      
      decision = fallbackDecision(turn, request.userInput)
      decision.reasoning = `${decision.reasoning}。原因：${errorMessage}`
    }

    const recentToolSignature = `${decision.tool}:${String(decision.input?.target || decision.input?.source || '')}`
    const recentCalls = toolCalls.slice(-6).filter(call => 
      call.phase === 'execution' && 
      `${call.tool}:${String(call.input?.target || call.input?.source || '')}` === recentToolSignature
    )

    // Also catch repeated failures on tools with no stable target (e.g. execute_python)
    const recentFailures = toolCalls.slice(-4).filter(call =>
      call.phase === 'execution' &&
      call.tool === decision.tool &&
      call.success === false
    )
    
    if (recentCalls.length >= 3 || recentFailures.length >= 2) {
      const loopReason = recentFailures.length >= 2
        ? `${decision.tool} 连续失败 ${recentFailures.length} 次（最后错误：${recentFailures.at(-1)?.error || '未知'}），必须换一种方式完成任务。`
        : `连续 ${recentCalls.length + 1} 次调用 ${decision.tool}${decision.input?.target ? ` 目标 ${decision.input.target}` : ''}，仍未产出结果。`
      stopReason = 'max_turns'
      assistantMessage = `遇到阻碍：${loopReason}建议补充更多信息后重试，或换一种描述方式。`
      pushLog(logs, 'agent-loop', 'error', `第 ${turn} 轮检测到死循环，终止执行`)
      workflowSteps.push({
        module: `Agent Loop ${turn}`,
        status: 'error',
        output: assistantMessage,
      })
      break
    }

    const repeatedUnsupportedTarget = typeof decision.input?.target === 'string'
      ? taskState.unsupportedFiles?.find(item => item.name === decision.input.target)
      : undefined

    if (repeatedUnsupportedTarget && (decision.tool === 'read_file' || decision.tool === 'inspect_file')) {
      stopReason = 'clarification_required'
      assistantMessage = `我已经确认文件「${repeatedUnsupportedTarget.name}」当前无法可靠解析，继续尝试只会重复失败。请提供可编辑版本（如 .docx），或让我改为输出字段草稿。`
      const clarificationRequest: ClarificationRequest = {
        question: assistantMessage,
        reason: '重复尝试不可解析文件',
        missingDetails: ['可可靠解析的文件版本，或接受降级输出'],
        options: ['上传可编辑版本', '先输出字段草稿'],
      }
      taskState = {
        ...taskState,
        blockers: [...new Set([...(taskState.blockers || []), repeatedUnsupportedTarget.reason])],
        pendingClarification: clarificationRequest,
      }
      await updateSessionStatus(request.sessionId, 'awaiting_clarification', {
        stopRequested: false,
        taskStage: currentStage,
        deliverablePlan: refreshedDeliverablePlan,
        taskState,
      })
      workflowSteps.push({
        module: `Agent Loop ${turn}`,
        status: 'completed',
        output: `停止重复尝试不可解析文件：${repeatedUnsupportedTarget.name}`,
      })
      pushLog(logs, 'clarification', 'info', `检测到重复尝试不可解析文件：${repeatedUnsupportedTarget.name}`)
      break
    }

    const decisionRecord: ToolCallRecord = {
      turn,
      phase: 'decision',
      tool: decision.tool,
      input: decision.input,
      success: true,
      outputSummary: `准备执行工具 ${decision.tool}`,
      outputPreview: JSON.stringify(decision.input, null, 2).slice(0, 4000),
      createdAt: new Date().toISOString(),
    }
    toolCalls.push(decisionRecord)

    pushLog(logs, 'agent-decision', 'info', `第 ${turn} 轮决策：${decision.tool} ${JSON.stringify(decision.input)}`)
    workflowSteps.push({
      module: `Decision ${turn}`,
      status: 'completed',
      output: `动作：${decision.tool}\n输入：${JSON.stringify(decision.input, null, 2)}`,
    })
    await updateSessionStatus(request.sessionId, 'executing', {
      stopRequested: false,
      taskStage: currentStage,
      deliverablePlan: refreshedDeliverablePlan,
      taskState,
      result: {
        success: false,
        stopReason: 'max_turns',
        message: assistantMessage,
        workflowSteps: workflowSteps.slice(-6),
        logs: logs.slice(-8),
        generatedCode: undefined,
        taskDescription: request.userInput,
        contextRecords: [],
        toolCalls: [],
        taskStage: currentStage,
        deliverablePlan: refreshedDeliverablePlan,
        taskState,
      },
    })

    if (decision.tool === 'end_turn' && !canEndTurn(snapshot, [...latestSession.toolCalls, ...toolCalls], refreshedDeliverablePlan)) {
      consecutiveEndTurnCount++
      
      if (consecutiveEndTurnCount >= MAX_CONSECUTIVE_END_TURNS) {
        stopReason = 'max_turns'
        assistantMessage = `检测到连续 ${consecutiveEndTurnCount} 次尝试结束但无可交付产物，系统陷入循环。这可能是因为：1) 模型服务异常；2) 任务配置不清晰；3) 缺少必要的输入文件。建议检查模型服务状态、任务描述或上传相关文件后重试。`
        pushLog(logs, 'agent-loop', 'error', `第 ${turn} 轮检测到循环，终止执行`)
        workflowSteps.push({
          module: `Agent Loop ${turn}`,
          status: 'error',
          output: assistantMessage,
        })
        break
      }
      
      pushLog(logs, 'agent-loop', 'info', `第 ${turn} 轮：拒绝过早结束（第 ${consecutiveEndTurnCount} 次），继续生成可交付结果`)
      workflowSteps.push({
        module: `Agent Loop ${turn}`,
        status: 'running',
        output: `检测到尚无可交付产物，拦截 end_turn（第 ${consecutiveEndTurnCount} 次），继续执行。`,
      })
      currentStage = deriveNextStage(currentStage, 'observe_workspace', { summary: '尚无可交付产物，继续执行' })
      continue
    }

    if (decision.tool === 'end_turn') {
      const qualityReport = await validateOutputQuality({
        session: latestSession,
        snapshot,
        plan: refreshedDeliverablePlan,
        userInput: request.userInput,
      })
      if (!qualityReport.passed) {
        consecutiveEndTurnCount++
        const issueSummary = qualityReport.issues
          .filter(issue => issue.severity === 'error')
          .map(issue => `${issue.file}: ${issue.message}`)
          .join('；')
        pushLog(logs, 'quality-check', 'error', `拦截 end_turn：${issueSummary || qualityReport.summary}`)
        workflowSteps.push({
          module: `Quality Check ${turn}`,
          status: 'error',
          output: `输出质量检测未通过，已阻止结束。${issueSummary || qualityReport.summary}`,
        })
        currentStage = 'produce_outputs'
        taskState = {
          ...taskState,
          stage: currentStage,
          blockers: [...new Set([...(taskState.blockers || []), issueSummary || qualityReport.summary])],
        }
        continue
      }
      pushLog(logs, 'quality-check', 'success', qualityReport.summary)
    }
    
    if (decision.tool !== 'end_turn') {
      consecutiveEndTurnCount = 0
    }

    const result = await executeToolWithRetry(
      decision.tool,
      decision.input,
      (toolName, toolInput) => executeTool(toolName, toolInput, latestSession, snapshot, request.userInput),
    )

    const callRecord: ToolCallRecord = {
      turn,
      phase: 'execution',
      tool: decision.tool,
      input: decision.input,
      success: result.success ?? !result.error,
      outputSummary: result.summary,
      outputPreview: typeof result.data === 'string' ? result.data.slice(0, 4000) : undefined,
      outputData: typeof result.data === 'string' ? undefined : result.data,
      artifacts: result.artifacts || (result.createdFile ? [result.createdFile] : []),
      error: result.error,
      createdAt: new Date().toISOString(),
    }
    toolCalls.push(callRecord)

    const contextRecord: AgentContextRecord = {
      turn,
      observation: snapshot.summary,
      action: `${decision.tool}: ${decision.reasoning}`,
      result: result.summary,
      stage: currentStage,
      createdAt: new Date().toISOString(),
    }
    contextRecords.push(contextRecord)

    pushLog(logs, 'agent-loop', result.success === false ? 'error' : 'info', `第 ${turn} 轮：${decision.reasoning}`)
    workflowSteps.push({
      module: `Agent Loop ${turn}`,
      status: decision.tool === 'end_turn' ? 'completed' : (result.success === false ? 'error' : 'running'),
      output: `[阶段 ${currentStage}] ${snapshot.summary}\n\n动作：${decision.tool}\n结果：${result.summary}`,
      code: typeof result.data === 'string' ? result.data : undefined,
    })

    currentStage = deriveNextStage(currentStage, decision.tool, result)
    taskState = updateTaskState(taskState, currentStage, snapshot, refreshedDeliverablePlan, selectedSkill, toolCalls, decision.tool, result)
    await updateSessionStatus(request.sessionId, 'executing', {
      stopRequested: false,
      taskStage: currentStage,
      deliverablePlan: refreshedDeliverablePlan,
      taskState,
      result: {
        success: false,
        stopReason: 'max_turns',
        message: assistantMessage,
        workflowSteps: workflowSteps.slice(-6),
        logs: logs.slice(-8),
        generatedCode: undefined,
        taskDescription: request.userInput,
        contextRecords: [],
        toolCalls: [],
        taskStage: currentStage,
        deliverablePlan: refreshedDeliverablePlan,
        taskState,
      },
    })

    if (decision.tool === 'end_turn') {
      stopReason = 'end_turn'
      assistantMessage = String(decision.input.finalAnswer || result.summary)
      workflowSteps[workflowSteps.length - 1] = {
        ...workflowSteps[workflowSteps.length - 1],
        status: 'completed',
      }
      break
    }
  }

  if (!assistantMessage) {
    assistantMessage = '已达到最大轮次，当前停止执行。你可以补充更明确的文件或目标后继续。'
  }

  await ensureFinalReport(session, request.userInput, assistantMessage, toolCalls, workflowSteps)

  if (selectedSkill) {
    try {
      await bumpSkillUsage(selectedSkill.id, stopReason === 'end_turn')
    } catch (error) {
      console.error('更新技能使用统计失败:', error)
    }
  }

  return {
    success: stopReason === 'end_turn',
    stopReason,
    message: assistantMessage,
    workflowSteps,
    logs,
    generatedCode: extractGeneratedCode(toolCalls),
    taskDescription: request.userInput,
    contextRecords,
    toolCalls,
    taskStage: currentStage,
    deliverablePlan: refreshDeliverablePlan(deliverablePlan, await observeWorkspace(await getRequiredSession(request.sessionId))),
    taskState,
    taskUnderstanding: understanding,
  }
}

async function decideNextTool(params: {
  turn: number
  maxTurns: number
  userInput: string
  snapshot: WorkspaceSnapshot
  contextPack?: ContextPack
  currentStage: SessionRecord['taskStage']
  messages: SessionRecord['messages']
  deliverablePlan?: DeliverablePlan
  selectedSkill?: SkillRecord
  skillContent?: string | null
  taskState?: TaskState
  clarificationPolicy?: SessionRecord['clarificationPolicy']
  contextRecords: AgentContextRecord[]
  toolCalls: ToolCallRecord[]
  sessionId?: string
  userId?: string
  understanding?: TaskUnderstanding
}): Promise<ToolDecision> {
  const spreadsheetSource = inferPrimaryWorkspaceSpreadsheet(params.snapshot)
  const isDocumentExploration = params.taskState?.explorationMode === 'documents'

  if (isDocumentExploration) {
    const explorationSummary = params.taskState?.explorationSummary
    const hasEnoughSamples = (explorationSummary?.sampleCount || 0) >= Math.min(params.snapshot.workspaceFiles.length, 3)
    const hasStructureArtifact = params.snapshot.outputFiles.some(file => file.name === 'document-structure-summary.json')
    const convertedDocxOutput = findConvertedDocxOutput(params.snapshot)
    const sourceDocx = findPrimaryWorkspaceDocx(params.snapshot)

    const target = params.snapshot.workspaceFiles
      .map(file => file.name)
      .find(name => name.endsWith('.docx') && !params.taskState?.inspectedFiles.includes(name))

    if (target && !hasEnoughSamples && isDocumentExploration) {
      return {
        tool: 'read_file',
        input: { target, location: 'workspace' },
        reasoning: '当前是多文档通用探索阶段，先读取少量 Word 文档样本再决定后续统计策略。',
      }
    }
  }

  const config = await loadDeepSeekConfig()
  const decision = await requestToolDecision({
    config,
    turn: params.turn,
    maxTurns: params.maxTurns,
    userInput: params.userInput,
    currentStage: params.currentStage || 'understand',
    snapshot: params.snapshot,
    contextPack: params.contextPack,
    contextRecords: params.contextRecords,
    toolCalls: params.toolCalls,
    messages: params.messages,
    deliverablePlan: params.deliverablePlan,
    selectedSkill: params.selectedSkill,
    skillContent: params.skillContent || undefined,
    taskState: params.taskState,
    clarificationPolicy: params.clarificationPolicy,
    tools: TOOL_DEFINITIONS,
    sessionId: params.sessionId,
    userId: params.userId,
    understanding: params.understanding,
  })

  return {
    tool: decision.tool,
    input: decision.input || {},
    reasoning: decision.reasoning || '模型未提供原因，使用默认说明',
  }
}

async function buildContextPack(userInput: string, session: SessionRecord, snapshot: WorkspaceSnapshot): Promise<ContextPack> {
  const normalizedInput = String(userInput || '').toLowerCase()
  const files = snapshot.workspaceFiles.map(file => {
    const name = file.name
    const lowerName = name.toLowerCase()
    const isSpreadsheet = /\.(xlsx|xls|csv)$/i.test(name)
    const isDocument = /\.(docx|doc|pdf)$/i.test(name)
    const isData = /\.(json|txt|md)$/i.test(name)
    const kind: ContextPack['candidateInputs'][number]['kind'] = isSpreadsheet
      ? 'spreadsheet'
      : isDocument
        ? 'document'
        : isData
          ? 'data'
          : /\.(ts|tsx|js|jsx|py|java|go|rs|c|cpp)$/i.test(name)
            ? 'text'
            : 'other'

    const reasons: string[] = []
    let priority = 0

    if (normalizedInput.includes(lowerName)) {
      priority += 100
      reasons.push('用户输入中直接提到该文件')
    }

    if (isSpreadsheet && /excel|xlsx|xls|csv|表格|汇总|统计/.test(normalizedInput)) {
      priority += 60
      reasons.push('与表格任务高度匹配')
    }

    if (isDocument && /word|doc|docx|pdf|文档|附件|材料|报告/.test(normalizedInput)) {
      priority += 60
      reasons.push('与文档任务高度匹配')
    }

    if (isData && /json|txt|markdown|md|文本|说明|配置/.test(normalizedInput)) {
      priority += 35
      reasons.push('与数据/文本任务匹配')
    }

    if (file.size < 1024 * 1024 * 2) {
      priority += 8
      reasons.push('文件较小，适合优先读取')
    }

    if (!reasons.length) {
      reasons.push('作为工作区候选输入保留')
    }

    return {
      name,
      kind,
      size: file.size,
      priority,
      reasons,
    }
  })

  const sorted = files.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, 'zh-CN'))
  const userIntent = /excel|xlsx|xls|csv|表格|汇总|统计/.test(normalizedInput)
    ? 'spreadsheet'
    : /word|doc|docx|pdf|文档|附件|材料|报告/.test(normalizedInput)
      ? 'document'
      : /json|txt|markdown|md|文本|配置|数据/.test(normalizedInput)
        ? 'data'
        : 'generic'
  const recommendedStage = userIntent === 'generic' ? 'understand' : 'inspect_files'
  const candidateInputs = await enrichContextCandidates(session, sorted.slice(0, 4))
  const pinnedFiles = candidateInputs.filter(file => file.priority >= 60).map(file => file.name)
  const avoidedFiles = files.filter(file => file.kind === 'other' && file.priority < 10).map(file => file.name).slice(0, 12)
  const summary = candidateInputs.length
    ? `优先关注 ${candidateInputs.map(file => `${file.name}(${file.kind},${file.priority})`).join('、')}`
    : '当前工作区暂无可优先编排的输入文件'

  return {
    userIntent,
    recommendedStage,
    candidateInputs,
    pinnedFiles,
    avoidedFiles,
    summary,
  }
}

async function enrichContextCandidates(session: SessionRecord, candidates: ContextPack['candidateInputs']): Promise<ContextPack['candidateInputs']> {
  return await Promise.all(candidates.map(async candidate => ({
    ...candidate,
    summary: await summarizeCandidateFile(session, candidate),
  })))
}

async function summarizeCandidateFile(session: SessionRecord, candidate: ContextPack['candidateInputs'][number]) {
  try {
    const fullPath = await resolveWorkspaceFilePath(session, candidate.name)

    if (candidate.kind === 'spreadsheet' && /\.(xlsx|xls)$/i.test(candidate.name)) {
      const preview = await previewSpreadsheet(fullPath)
      return `Excel：主表 ${preview.primarySheetName}；表头 ${preview.primaryHeaders.slice(0, 6).join('、') || '无'}；约 ${preview.rowCount} 行`
    }

    if (candidate.kind === 'spreadsheet' && /\.csv$/i.test(candidate.name)) {
      const summary = await readFileSummary(session, candidate.name, 'workspace', { offset: 0, limit: 8 })
      return String(summary.summary || '').slice(0, 240)
    }

    if (candidate.kind === 'document' && /\.docx$/i.test(candidate.name)) {
      const extracted = await extractWordText(fullPath)
      return `Word：${extracted.preview.replace(/\s+/g, ' ').slice(0, 180) || '无可提取预览'}`
    }

    if (candidate.kind === 'data' && /\.json$/i.test(candidate.name)) {
      const summary = await readFileSummary(session, candidate.name, 'workspace', { offset: 0, limit: 20 })
      return String(summary.summary || '').slice(0, 240)
    }

    if (candidate.kind === 'data' || candidate.kind === 'text') {
      const summary = await readFileSummary(session, candidate.name, 'workspace', { offset: 0, limit: 12 })
      return String(summary.data || summary.summary || '').replace(/\s+/g, ' ').slice(0, 240)
    }

    return `${candidate.kind} 文件，大小 ${candidate.size} 字节`
  } catch {
    return `${candidate.kind} 文件，暂未生成摘要`
  }
}

function inferPrimaryWorkspaceSpreadsheet(snapshot: WorkspaceSnapshot) {
  const spreadsheet = snapshot.workspaceFiles.find(file => /\.xlsx?$/i.test(file.name))
  return spreadsheet?.name
}

function findPrimaryWorkspaceDocx(snapshot: WorkspaceSnapshot) {
  return snapshot.workspaceFiles
    .map(file => file.name)
    .find(name => name.toLowerCase().endsWith('.docx'))
}

function findConvertedDocxOutput(snapshot: WorkspaceSnapshot) {
  return snapshot.outputFiles
    .map(file => file.name)
    .find(name => name.toLowerCase().endsWith('-converted.docx'))
}

function fallbackDecision(turn: number, userInput: string): ToolDecision {
  if (turn === 1) {
    return {
      tool: 'observe_workspace',
      input: {},
      reasoning: '模型决策失败，兜底先观察工作区',
    }
  }

  if (turn === 2 && /xlsx|excel|表格|csv|docx|word|文档|doc|模板/i.test(userInput)) {
    return {
      tool: 'inspect_file',
      input: { target: '' },
      reasoning: '模型决策失败，兜底尝试进入文件理解阶段',
    }
  }

  if (turn === 2 && /mcp/i.test(userInput)) {
    return {
      tool: 'list_mcp_tools',
      input: { serverId: 'filesystem' },
      reasoning: '模型决策失败，但用户提到了 MCP，兜底先列出 filesystem 服务工具',
    }
  }

  if (turn === 2) {
    return {
      tool: 'list_workspace_tree',
      input: {},
      reasoning: '模型决策失败，兜底列出工作区结构',
    }
  }

  return {
    tool: 'end_turn',
    input: {
      finalAnswer: '本轮已使用兜底流程结束。请补充更多细节后继续执行。',
    },
    reasoning: '模型决策失败，兜底结束本轮',
  }
}

async function getRequiredSession(sessionId: string): Promise<SessionRecord> {
  const session = await getSession(sessionId)
  if (!session) throw new Error('会话不存在')
  return session
}

async function observeWorkspace(session: SessionRecord): Promise<WorkspaceSnapshot> {
  const config = await loadDeepSeekConfig()
  const [workspaceFiles, outputFiles] = await Promise.all([
    listFilePreviews(config, session.workspace_path),
    listFilePreviews(config, session.output_path),
  ])

  const summary = [
    `工作区文件 ${workspaceFiles.length} 个`,
    workspaceFiles.length ? `工作区包含：${workspaceFiles.map(file => file.name).join('、')}` : '工作区当前无文件',
    `输出文件 ${outputFiles.length} 个`,
    outputFiles.length ? `输出区包含：${outputFiles.map(file => file.name).join('、')}` : '输出区当前无文件',
  ].join('；')

  return { workspaceFiles, outputFiles, summary }
}

async function listFilePreviews(config: DeepSeekConfig, dirPath: string): Promise<WorkspaceFilePreview[]> {
  const result = await callMcpTool(config, {
    serverId: 'filesystem',
    toolName: 'list_directory_with_sizes',
    argumentsPayload: {
      path: dirPath,
      sortBy: 'name',
    },
  })
  return parseDirectoryListing(result.content)
}

function parseDirectoryListing(content: string): WorkspaceFilePreview[] {
  const previews = content.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('[FILE]'))
    .map((line, index): WorkspaceFilePreview | null => {
      const match = line.match(/^\[FILE\]\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i)
      if (!match) return null
      const name = decodePossibleMojibake(match[1].trim())
      return {
        name,
        size: parseSizeLabel(`${match[2]} ${match[3]}`),
        modifiedAt: new Date(index).toISOString(),
      }
    })
    .filter((item): item is WorkspaceFilePreview => item !== null)

  return previews
}

function parseSizeLabel(label: string) {
  const normalized = label.trim().toUpperCase()
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/)
  if (!match) return 0

  const value = Number(match[1])
  const unit = match[2] || 'B'
  const multiplier = unit === 'GB'
    ? 1024 ** 3
    : unit === 'MB'
      ? 1024 ** 2
      : unit === 'KB'
        ? 1024
        : 1

  return Math.round(value * multiplier)
}

function mapFilesystemMcpArguments(
  session: SessionRecord,
  toolName: string,
  argumentsPayload: Record<string, unknown>,
): Record<string, unknown> {
  const nextPayload: Record<string, unknown> = { ...argumentsPayload }

  if (toolName === 'read_multiple_files' && Array.isArray(argumentsPayload.paths)) {
    nextPayload.paths = argumentsPayload.paths.map(item =>
      resolveFilesystemMcpPath(session, String(item), 'workspace'),
    )
    return nextPayload
  }

  if (toolName === 'move_file') {
    if (typeof argumentsPayload.source === 'string') {
      nextPayload.source = resolveFilesystemMcpPath(session, argumentsPayload.source, 'workspace')
    }
    if (typeof argumentsPayload.destination === 'string') {
      nextPayload.destination = resolveFilesystemMcpPath(session, argumentsPayload.destination, inferFilesystemPathZone(argumentsPayload.destination, 'output'))
    }
    return nextPayload
  }

  for (const key of ['path', 'source', 'destination'] as const) {
    const value = argumentsPayload[key]
    if (typeof value !== 'string') continue
    nextPayload[key] = resolveFilesystemMcpPath(session, value, inferFilesystemPathZone(value, key === 'destination' ? 'output' : 'workspace'))
  }

  return nextPayload
}

function inferFilesystemPathZone(value: string, fallback: 'workspace' | 'output') {
  if (value.startsWith('output/')) return 'output'
  if (value.startsWith('workspace/')) return 'workspace'
  return fallback
}

function resolveFilesystemMcpPath(
  session: SessionRecord,
  value: string,
  fallback: 'workspace' | 'output',
) {
  if (!value) return value
  if (path.isAbsolute(value)) return value
  if (value === '.' || value === './') return fallback === 'output' ? session.output_path : session.workspace_path

  if (value.startsWith('workspace/')) {
    return safeJoin(session.workspace_path, value.slice('workspace/'.length))
  }

  if (value.startsWith('output/')) {
    return safeJoin(session.output_path, value.slice('output/'.length))
  }

  return fallback === 'output'
    ? safeJoin(session.output_path, value)
    : safeJoin(session.workspace_path, value)
}

async function executeTool(
  tool: ToolName,
  input: Record<string, unknown>,
  session: SessionRecord,
  snapshot: WorkspaceSnapshot,
  userInput: string,
): Promise<ToolResult> {
  switch (tool) {
    case 'observe_workspace':
      return { summary: snapshot.summary, data: snapshot }
    case 'list_workspace_tree': {
      const tree = snapshot.workspaceFiles.map(file => `workspace/${file.name}`).concat(snapshot.outputFiles.map(file => `output/${file.name}`))
      return { summary: tree.length ? tree.join('\n') : '当前没有可列出的文件', data: tree.join('\n'), success: true }
    }
    case 'inspect_file': {
      const target = String(input.target || '')
      if (!target) return { summary: '未提供要分析的文件名', success: false, error: 'missing_target' }
      const resolvedPath = await resolveReadableFilePath(session, target, input.location)
      const inspected = await inspectFile(resolvedPath)
      if (/\.docx?$/i.test(target)) {
        const detectedFormat = await detectWordFormat(resolvedPath)
        if (detectedFormat === 'doc' && /\.docx$/i.test(target)) {
          inspected.risks = [...new Set([...(inspected.risks || []), '文件后缀为 .docx，但实际是旧版 OLE Word 文档'])]
          inspected.summary += '；检测到该文件真实格式为旧版 Word（OLE），建议先转换后再处理'
        }
      }
      return {
        summary: inspected.summary,
        data: JSON.stringify(inspected, null, 2).slice(0, 12000),
        success: true,
      }
    }
    case 'read_file': {
      const target = String(input.target || '')
      if (!target) return { summary: '未提供要读取的文件名' }
      return readFileSummary(session, target, input.location, { offset: input.offset, limit: input.limit, blockIds: input.blockIds, blockType: input.blockType })
    }
    case 'read_multiple_files': {
      const targets = Array.isArray(input.targets) ? input.targets.map(String) : []
      const contents = await Promise.all(targets.slice(0, 5).map(target => readFileSummary(session, target, input.location)))
      return {
        summary: `已读取 ${contents.length} 个文件`,
        data: contents.map(item => String(item.data || item.summary)).join('\n\n'),
        success: true,
      }
    }
    case 'preview_spreadsheet': {
      const target = String(input.target || '')
      if (!target) return { summary: '未提供 Excel 文件名', success: false, error: 'missing_target' }
      const resolvedPath = await resolveReadableFilePath(session, target, input.location)
      const preview = await previewSpreadsheet(resolvedPath)
      return {
        summary: `已预览 Excel 文件 ${target}，主表 ${preview.primarySheetName}，约 ${preview.rowCount} 行`,
        data: JSON.stringify(preview, null, 2).slice(0, 12000),
        success: true,
      }
    }
    case 'execute_python': {
      const code = String(input.code || '')
      const description = String(input.description || 'Python 脚本执行')
      if (!code.trim()) return { summary: '未提供 Python 代码', success: false, error: 'missing_code' }
      return executePythonInSandbox(session, code, description)
    }
    case 'write_file': {
      const target = normalizeOutputTarget(String(input.target || 'result.txt'))
      const content = String(input.content || '')
      return writeOutputFile(session, target, content)
    }
    case 'write_markdown_report': {
      const target = normalizeOutputTarget(String(input.target || 'final-report.md'))
      const title = String(input.title || '任务报告')
      const sections = Array.isArray(input.sections) ? input.sections.map(String) : []
      const content = [`# ${title}`, '', ...sections.map((section, index) => `## 模块 ${index + 1}\n${section}`)].join('\n\n')
      return writeOutputFile(session, target, content)
    }
    case 'write_json_result': {
      const target = normalizeOutputTarget(String(input.target || 'result.json'))
      const payload = input.payload && typeof input.payload === 'object' ? input.payload : { userInput, snapshot }
      const content = JSON.stringify(payload, null, 2)
      return writeOutputFile(session, target, content)
    }
    case 'copy_workspace_file_to_output': {
      const source = String(input.source || '')
      const target = normalizeOutputTarget(String(input.target || path.basename(source || 'copied-file.txt')))
      if (!source) return { summary: '未提供 source 文件' }
      return copyWorkspaceFileToOutput(session, source, target)
    }
    case 'list_mcp_tools': {
      const config = await loadDeepSeekConfig()
      const serverId = normalizeSupportedServerId(String(input.serverId || config.mcpServers?.[0]?.id || ''), config)
      if (!serverId) return { summary: '未配置可用的 MCP 服务' }
      const tools = await listMcpTools(config, serverId)
      const summary = `MCP 服务 ${serverId} 共暴露 ${tools.length} 个工具`
      return {
        summary,
        data: JSON.stringify({ serverId, tools }, null, 2).slice(0, 12000),
      }
    }
    case 'call_mcp_tool': {
      const config = await loadDeepSeekConfig()
      const serverId = normalizeSupportedServerId(String(input.serverId || config.mcpServers?.[0]?.id || ''), config)
      const toolName = String(input.toolName || '')
      const rawArgumentsPayload = input.arguments && typeof input.arguments === 'object'
        ? input.arguments as Record<string, unknown>
        : {}
      const argumentsPayload = serverId === 'filesystem'
        ? mapFilesystemMcpArguments(session, toolName, rawArgumentsPayload)
        : rawArgumentsPayload
      if (!serverId) return { summary: '未配置可用的 MCP 服务' }
      if (!toolName) return { summary: '未提供 MCP 工具名' }
      const result = await callMcpTool(config, { serverId, toolName, argumentsPayload })
      const summary = result.isError
        ? `MCP 工具 ${serverId}.${toolName} 执行失败`
        : `MCP 工具 ${serverId}.${toolName} 执行成功`
      return {
        summary,
        data: result.content || JSON.stringify(result.structuredContent || result.raw, null, 2).slice(0, 12000),
      }
    }
    case 'end_turn':
      return { summary: String(input.finalAnswer || '任务结束') }
    default:
      return {
        summary: `工具 ${tool} 不存在或已被移除`,
        success: false,
        error: 'unknown_tool',
      }
  }
}

function normalizeSupportedServerId(serverId: string, config: DeepSeekConfig) {
  const allowedServerIds = (config.mcpServers || []).map(server => server.id)
  const normalized = serverId.trim().toLowerCase()
  if (!normalized) return allowedServerIds[0] || ''
  if (allowedServerIds.includes(normalized)) return normalized
  if (['spreadsheet', 'excel', 'office', 'table', 'tables'].includes(normalized)) {
    return allowedServerIds.includes('filesystem') ? 'filesystem' : (allowedServerIds[0] || normalized)
  }
  return normalized
}

async function ensurePathParentExists(targetPath: string) {
  const parentPath = path.dirname(targetPath)
  await callMcpTool(await loadDeepSeekConfig(), {
    serverId: 'filesystem',
    toolName: 'create_directory',
    argumentsPayload: { path: parentPath },
  })
}

async function writeOutputFile(session: SessionRecord, target: string, content: string): Promise<ToolResult> {
  const fullPath = safeJoin(session.output_path, target)
  const config = await loadDeepSeekConfig()

  await ensurePathParentExists(fullPath)
  await callMcpTool(config, {
    serverId: 'filesystem',
    toolName: 'write_file',
    argumentsPayload: {
      path: fullPath,
      content,
    },
  })

  return {
    summary: `已写入 output/${target}`,
    data: content,
    createdFile: target,
  }
}

async function copyWorkspaceFileToOutput(session: SessionRecord, source: string, target: string): Promise<ToolResult> {
  const sourcePath = safeJoin(session.workspace_path, source)
  const targetPath = safeJoin(session.output_path, target)
  const config = await loadDeepSeekConfig()

  await ensurePathParentExists(targetPath)
  const readResult = await callMcpTool(config, {
    serverId: 'filesystem',
    toolName: 'read_text_file',
    argumentsPayload: {
      path: sourcePath,
    },
  })
  await callMcpTool(config, {
    serverId: 'filesystem',
    toolName: 'write_file',
    argumentsPayload: {
      path: targetPath,
      content: readResult.content,
    },
  })

  return { summary: `已复制 ${source} 到 output/${target}`, createdFile: target }
}

function selectWordBlocks(blocks: WordBlock[], options?: { offset?: unknown, limit?: unknown, blockIds?: unknown, blockType?: unknown }) {
  const offset = Math.max(0, Number(options?.offset || 0))
  const limit = Math.max(1, Number(options?.limit || 12))
  const requestedBlockIds = Array.isArray(options?.blockIds)
    ? options?.blockIds.map(item => String(item)).filter(Boolean)
    : []
  const blockType = String(options?.blockType || '').trim().toLowerCase()

  let selected = [...blocks]

  if (requestedBlockIds.length) {
    const wanted = new Set(requestedBlockIds)
    selected = selected.filter(block => wanted.has(block.id))
  }

  if (blockType === 'paragraph' || blockType === 'table') {
    selected = selected.filter(block => block.type === blockType)
  }

  const sliced = requestedBlockIds.length ? selected : selected.slice(offset, offset + limit)

  return {
    offset,
    limit,
    requestedBlockIds,
    blockType: blockType === 'paragraph' || blockType === 'table' ? blockType : '',
    blocks: sliced,
    totalAvailable: selected.length,
  }
}

function formatWordBlocksForRead(blocks: WordBlock[]) {
  return blocks.map(block => {
    if (block.type === 'table') {
      return {
        id: block.id,
        type: block.type,
        order: block.order,
        tableIndex: block.tableIndex,
        rowCount: block.rowCount,
        columnCount: block.columnCount,
        sampleRows: block.sampleRows || [],
      }
    }

    return {
      id: block.id,
      type: block.type,
      order: block.order,
      paragraphIndex: block.paragraphIndex,
      text: block.text || '',
    }
  })
}

function inputLikeBlockIds(options?: { offset?: unknown, limit?: unknown, blockIds?: unknown, blockType?: unknown }) {
  return options?.blockIds
}

function inputLikeBlockType(options?: { offset?: unknown, limit?: unknown, blockIds?: unknown, blockType?: unknown }) {
  return options?.blockType
}

async function readFileSummary(
  session: SessionRecord,
  target: string,
  location?: unknown,
  options?: { offset?: unknown, limit?: unknown, blockIds?: unknown, blockType?: unknown },
): Promise<ToolResult> {
  const fullPath = await resolveReadableFilePath(session, target, location)
  const config = await loadDeepSeekConfig()
  const ext = path.extname(target).toLowerCase()
  const offset = Math.max(0, Number(options?.offset || 0))
  const limit = Math.max(1, Number(options?.limit || 200))

  if (ext === '.doc') {
    return {
      summary: `旧版 Word 文件 ${target} 暂不支持可靠读取，请提供 .docx 版本后再继续自动处理`,
      data: JSON.stringify({
        file: target,
        ext,
        parseable: false,
        binaryLike: true,
        suggestedAction: '请将 .doc 转成 .docx，或改为先输出可填写字段草稿',
      }, null, 2),
      success: false,
      error: 'unsupported_legacy_word',
    }
  }

  if (ext === '.docx') {
    const structure = await extractWordStructure(fullPath)
    const selection = selectWordBlocks(structure.blocks, {
      offset: options?.offset,
      limit: options?.limit,
      blockIds: inputLikeBlockIds(options),
      blockType: inputLikeBlockType(options),
    })

    return {
      summary: `读取 Word 文件 ${target} 成功，当前返回 ${selection.blocks.length} 个块，共 ${structure.blocks.length} 个块`,
      data: JSON.stringify({
        file: structure.file,
        summary: structure.summary,
        paragraphCount: structure.paragraphCount,
        tableCount: structure.tableCount,
        requestedBlockIds: selection.requestedBlockIds,
        blockType: selection.blockType || null,
        offset: selection.offset,
        limit: selection.limit,
        returnedBlockCount: selection.blocks.length,
        availableBlockCount: selection.totalAvailable,
        blocks: formatWordBlocksForRead(selection.blocks),
        warnings: structure.warnings,
      }, null, 2),
      success: true,
    }
  }

  if (ext === '.pdf') {
    // PDFs are binary; guide the model to use execute_python with pypdf/pdfplumber
    const stat = await fs.stat(fullPath).catch(() => null)
    const size = stat ? stat.size : 0
    return {
      summary: `PDF 文件 ${target}（约 ${(size / 1024).toFixed(1)} KB）。请使用 execute_python 调用 pypdf/pdfplumber 提取内容，不要用 read_file 直接读取二进制。`,
      data: JSON.stringify({
        file: target,
        ext,
        size,
        parseable: true,
        binaryLike: true,
        suggestedCode: [
          'import os',
          'from pypdf import PdfReader',
          `reader = PdfReader(os.path.join(os.environ['WORKSPACE_PATH'], '${target}'))`,
          'text = "\\n\\n".join(page.extract_text() or "" for page in reader.pages)',
          'with open(os.path.join(os.environ["OUTPUT_PATH"], "pdf-extraction.md"), "w") as f: f.write(text)',
        ].join('\n'),
      }, null, 2),
      success: true,
    }
  }

  const result = await callMcpTool(config, {
    serverId: 'filesystem',
    toolName: 'read_text_file',
    argumentsPayload: {
      path: fullPath,
    },
  })
  const content = result.content
  const lines = content.split(/\r?\n/)
  const selectedLines = lines.slice(offset, offset + limit)
  const rangedText = selectedLines.map((line, index) => `${offset + index + 1}|${line}`).join('\n')

  if (ext === '.json') {
    const parsed = JSON.parse(content)
    const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 20) : []
    return {
      summary: `读取 JSON 文件 ${target} 成功，顶层字段 ${keys.join('、') || '无'}`,
      data: JSON.stringify(parsed, null, 2).slice(0, 12000),
    }
  }

  if (ext === '.csv') {
    const header = lines.find(Boolean) || ''
    return {
      summary: `读取 CSV 文件 ${target} 成功，共 ${Math.max(lines.filter(Boolean).length - 1, 0)} 行数据`,
      data: ['# CSV 摘要', `文件：${target}`, `表头：${header}`, `读取范围：${offset + 1}-${Math.min(offset + selectedLines.length, lines.length)}`, '', rangedText].join('\n'),
    }
  }

  if (ext === '.md') {
    return {
      summary: `读取 Markdown 文件 ${target} 成功`,
      data: rangedText.slice(0, 12000),
    }
  }

  return {
    summary: `读取文件 ${target} 成功，共 ${lines.length} 行，本次返回 ${selectedLines.length} 行`,
    data: rangedText.slice(0, 12000),
  }
}

async function resolveReadableFilePath(
  session: SessionRecord,
  target: string,
  location?: unknown,
) {
  const normalizedLocation = location === 'output' ? 'output' : location === 'workspace' ? 'workspace' : undefined

  if (normalizedLocation === 'output') {
    return safeJoin(session.output_path, normalizeOutputTarget(target))
  }

  if (normalizedLocation === 'workspace') {
    return await resolveWorkspaceFilePath(session, target)
  }

  const outputTarget = normalizeOutputTarget(target)
  const outputExists = await outputFileExists(session, outputTarget)
  if (outputExists) {
    return safeJoin(session.output_path, outputTarget)
  }

  return await resolveWorkspaceFilePath(session, target)
}

async function outputFileExists(session: SessionRecord, target: string) {
  const outputSession = await getRequiredSession(session.id)
  return outputSession.output_path ? (await observeWorkspace(outputSession)).outputFiles.some(file => file.name === target) : false
}

async function resolveWorkspaceFilePath(session: SessionRecord, target: string) {
  const resolved = await findWorkspaceFilePath(session, target)
  if (resolved) return resolved
  return safeJoin(session.workspace_path, target)
}

async function ensureTaskPlan(session: SessionRecord, userInput: string, deliverablePlan?: DeliverablePlan) {
  void session
  void userInput
  void deliverablePlan
}

async function ensureFinalReport(
  session: SessionRecord,
  userInput: string,
  assistantMessage: string,
  toolCalls: ToolCallRecord[],
  workflowSteps: WorkflowStep[],
) {
  const reportPath = safeJoin(session.output_path, 'final-report.md')
  const config = await loadDeepSeekConfig()
  const outputFiles = await listFilePreviews(config, session.output_path)
  const hasDeliverableFile = outputFiles.some(file => !['task-plan.md', 'final-report.md'].includes(file.name))
  if (!hasDeliverableFile) return

  const content = [
    '# 最终执行报告',
    '',
    `- 用户目标：${userInput}`,
    `- 最终答复：${assistantMessage}`,
    `- 最终阶段：${session.taskStage || 'unknown'}`,
    `- 主要交付类型：${session.deliverablePlan?.primaryOutputType || '未确定'}`,
    '',
    '## 计划交付',
    '',
    ...(session.deliverablePlan?.outputFiles?.length
      ? session.deliverablePlan.outputFiles.map(item => `- ${item.filename}（${item.type}，用途：${item.purpose}）`)
      : ['- 无明确计划']),
    '',
    '## 输出文件',
    '',
    ...(outputFiles.length ? outputFiles.map(file => `- ${file.name}`) : ['- 无']),
    '',
    '## 工具调用轨迹',
    '',
    ...(toolCalls.length ? toolCalls.map(call => `- Turn ${call.turn}: ${call.tool} -> ${call.outputSummary}`) : ['- 无']),
    '',
    '## 工作流摘要',
    '',
    ...(workflowSteps.length ? workflowSteps.map(step => `- ${step.module}: ${step.output}`) : ['- 无']),
  ].join('\n')

  await callMcpTool(config, {
    serverId: 'filesystem',
    toolName: 'write_file',
    argumentsPayload: {
      path: reportPath,
      content,
    },
  })
}

function normalizeOutputTarget(target: string) {
  return target.replace(/^output\//, '')
}

function buildDeliverablePlan(userInput: string, session: SessionRecord, snapshot: WorkspaceSnapshot, selectedSkill?: SkillRecord, understanding?: TaskUnderstanding): DeliverablePlan {
  void session
  // 理解环节补全的关键词并入判定文本，模糊指令也能推断出正确交付物
  const understandingText = understanding ? `${understanding.goal} ${understanding.intentKeywords.join(' ')}`.toLowerCase() : ''
  const normalizedInput = `${userInput.toLowerCase()} ${understandingText}`
  const workspaceFileNames = snapshot.workspaceFiles.map(file => file.name.toLowerCase())
  const selectedInputs = snapshot.workspaceFiles.map(file => file.name)
  const hasDocx = workspaceFileNames.some(name => name.endsWith('.docx'))
  const hasWord = workspaceFileNames.some(name => /\.docx?$/.test(name))

  if (hasWord && /填写|填入|填到|套用|模板|空白位置|审批表|任免审批表|表格中/.test(normalizedInput)) {
    const templateFile = snapshot.workspaceFiles.find(file => /附件|审批表|模板|表格|\.doc$/i.test(file.name)) || snapshot.workspaceFiles.find(file => /\.docx?$/i.test(file.name))
    const baseName = (templateFile?.name || 'word-form').replace(/\.docx?$/i, '')
    return {
      primaryOutputType: 'docx',
      outputFiles: [
        {
          filename: `${baseName}-填写结果.docx`,
          type: 'docx',
          purpose: '按用户要求填写后的 Word 表单/模板',
          required: true,
          status: 'planned',
        },
        {
          filename: 'final-report.md',
          type: 'md',
          purpose: '辅助说明与执行报告',
          required: false,
          status: 'planned',
        },
      ],
      notes: ['检测到 Word 表单/模板填写任务，主交付物应为填写后的 .docx 文件，而不是文本结果。'],
      selectedInputs,
    }
  }

  if (hasDocx && /统计|汇总|得票|投票|评分|评议/.test(normalizedInput)) {
    return {
      primaryOutputType: 'json',
      outputFiles: [
        {
          filename: 'vote-statistics.json',
          type: 'json',
          purpose: '多份 Word 投票/评分统计结构化结果',
          required: true,
          status: 'planned',
        },
        {
          filename: 'vote-statistics-report.md',
          type: 'md',
          purpose: '统计结果报告',
          required: false,
          status: 'planned',
        },
      ],
      notes: ['检测到多份 Word 文档与统计意图，优先采用陌生任务模式先探索样本、再提取字段、再汇总输出'],
      selectedInputs,
    }
  }

  if (selectedSkill) {
    return {
      primaryOutputType: selectedSkill.deliverable_policy.primary_output_type,
      outputFiles: selectedSkill.deliverable_policy.default_outputs.map((item: DeliverablePlan['outputFiles'][number]) => ({ ...item, status: 'planned' })),
      notes: [
        `已匹配技能：${selectedSkill.name}`,
        ...(selectedSkill.execution_policy.guidance_rules || []),
      ],
      selectedInputs,
    }
  }

  const hasPdf = workspaceFileNames.some(name => name.endsWith('.pdf'))
  const wantsPdfExtract = hasPdf && /提取|转换|读取|excel|表格|文本|内容/.test(normalizedInput)
  const wantsExcel = /excel|xlsx|表格|统计|汇总/.test(normalizedInput) || workspaceFileNames.some(name => /\.xlsx?$/.test(name))
  const wantsCsv = /csv/.test(normalizedInput) || workspaceFileNames.some(name => name.endsWith('.csv'))
  const wantsJson = /json|结构化/.test(normalizedInput) || workspaceFileNames.some(name => name.endsWith('.json'))
  const wantsMarkdown = /报告|总结|markdown|md/.test(normalizedInput)

  if (wantsPdfExtract) {
    const pdfFile = snapshot.workspaceFiles.find(file => /\.pdf$/i.test(file.name))
    const baseName = (pdfFile?.name || 'pdf').replace(/\.pdf$/i, '')
    // Prefer xlsx if user mentions table/excel, otherwise markdown
    const outputAsXlsx = /excel|xlsx|表格/.test(normalizedInput)
    return {
      primaryOutputType: outputAsXlsx ? 'xlsx' : 'md',
      outputFiles: [
        {
          filename: outputAsXlsx ? `${baseName}-提取结果.xlsx` : `${baseName}-提取结果.md`,
          type: outputAsXlsx ? 'xlsx' : 'md',
          purpose: '从 PDF 提取的内容',
          required: true,
          status: 'planned',
        },
      ],
      notes: [
        '检测到 PDF 提取任务，使用 pypdf 读取文本或 pdfplumber 提取表格',
        '扫描版 PDF 目前无 OCR 能力，若首次尝试无文本应提示用户',
      ],
      selectedInputs,
    }
  }

  if (wantsExcel) {
    return {
      primaryOutputType: 'xlsx',
      outputFiles: [
        {
          filename: inferPrimaryOutputFilename(snapshot.workspaceFiles, 'xlsx'),
          type: 'xlsx',
          purpose: '主要办公交付文件',
          required: true,
          status: 'planned',
        },
        {
          filename: 'final-report.md',
          type: 'md',
          purpose: '辅助说明与执行报告',
          required: false,
          status: 'planned',
        },
      ],
      notes: session.messages.length ? ['结合用户历史消息和当前工作区文件动态推断交付物'] : ['基于当前工作区文件推断交付物'],
      selectedInputs,
    }
  }

  if (wantsCsv) {
    return {
      primaryOutputType: 'csv',
      outputFiles: [
        {
          filename: inferPrimaryOutputFilename(snapshot.workspaceFiles, 'csv'),
          type: 'csv',
          purpose: '表格类结构化交付',
          required: true,
          status: 'planned',
        },
      ],
      selectedInputs,
    }
  }

  if (wantsJson) {
    return {
      primaryOutputType: 'json',
      outputFiles: [
        {
          filename: 'result.json',
          type: 'json',
          purpose: '结构化结果交付',
          required: true,
          status: 'planned',
        },
      ],
      selectedInputs,
    }
  }

  if (wantsMarkdown) {
    return {
      primaryOutputType: 'md',
      outputFiles: [
        {
          filename: 'final-report.md',
          type: 'md',
          purpose: '分析报告与说明',
          required: true,
          status: 'planned',
        },
      ],
      selectedInputs,
    }
  }

  return {
    primaryOutputType: 'txt',
    outputFiles: [
      {
        filename: 'result.txt',
        type: 'txt',
        purpose: '默认文本结果',
        required: true,
        status: 'planned',
      },
    ],
    selectedInputs,
  }
}

function refreshDeliverablePlan(plan: DeliverablePlan, snapshot: WorkspaceSnapshot): DeliverablePlan {
  const outputNames = new Set(snapshot.outputFiles.map(file => file.name))
  return {
    ...plan,
    selectedInputs: snapshot.workspaceFiles.map(file => file.name),
    outputFiles: plan.outputFiles.map(item => ({
      ...item,
      status: outputNames.has(item.filename) ? 'generated' : 'missing',
    })),
  }
}

function inferPrimaryOutputFilename(files: WorkspaceFilePreview[], type: DeliverablePlan['primaryOutputType']) {
  const primaryInput = files.find(file => /\.(xlsx?|csv|json)$/i.test(file.name))
  if (!primaryInput) return `result.${type}`
  const base = primaryInput.name.replace(/\.[^.]+$/, '')
  return `${base}-处理结果.${type}`
}

function inferExplorationMode(snapshot: WorkspaceSnapshot, selectedSkill?: SkillRecord): TaskState['explorationMode'] {
  const workspaceNames = snapshot.workspaceFiles.map(file => file.name.toLowerCase())
  const hasDocx = workspaceNames.some(name => name.endsWith('.docx'))
  const hasStructured = workspaceNames.some(name => /\.(xlsx?|csv|json)$/i.test(name))

  if (hasDocx && !hasStructured) return 'documents'
  if (!selectedSkill) return 'generic'
  return 'none'
}

function buildTaskState(
  session: SessionRecord,
  stage: SessionRecord['taskStage'],
  snapshot: WorkspaceSnapshot,
  deliverablePlan: DeliverablePlan,
  selectedSkill?: SkillRecord,
  contextPack?: ContextPack,
): TaskState {
  void session
  return {
    stage: stage || 'understand',
    selectedSkillId: selectedSkill?.id,
    selectedSkillName: selectedSkill?.name,
    selectedInputs: contextPack?.pinnedFiles?.length
      ? contextPack.pinnedFiles
      : (deliverablePlan.selectedInputs || snapshot.workspaceFiles.map(file => file.name)),
    inspectedFiles: [],
    producedOutputs: snapshot.outputFiles.map(file => file.name),
    blockers: [],
    unsupportedFiles: [],
    explorationMode: inferExplorationMode(snapshot, selectedSkill),
    explorationSummary: undefined,
    pendingClarification: undefined,
  }
}

function inferDocumentExplorationSummary(
  toolCalls: ToolCallRecord[],
  snapshot: WorkspaceSnapshot,
  previous?: TaskState['explorationSummary'],
): TaskState['explorationSummary'] | undefined {
  const documentCalls = toolCalls.filter(call =>
    call.phase === 'execution'
    && call.tool === 'read_file'
    && typeof call.input.target === 'string'
    && String(call.input.target).toLowerCase().endsWith('.docx')
    && typeof call.outputPreview === 'string',
  )

  if (!documentCalls.length && !previous) return undefined

  const combinedText = documentCalls.map(call => call.outputPreview || '').join('\n')
  const matchedSignals = [
    /评分表|互评|评议/.test(combinedText) ? '评分表/互评' : '',
    /得票|票数|投票/.test(combinedText) ? '得票/投票' : '',
    /姓名/.test(combinedText) ? '姓名字段' : '',
    /优秀|合格|基本合格|不合格/.test(combinedText) ? '评价等级' : '',
  ].filter(Boolean)

  const likelyDocumentTask = matchedSignals.includes('得票/投票') || (matchedSignals.includes('评分表/互评') && matchedSignals.includes('姓名字段'))
    ? 'vote-statistics'
    : documentCalls.length >= Math.min(snapshot.workspaceFiles.length, 2)
      ? 'document-summary'
      : previous?.likelyDocumentTask

  return {
    sampleCount: documentCalls.length,
    likelyDocumentTask,
    matchedSignals,
    sampleTargets: documentCalls.map(call => String(call.input.target)).slice(0, 5),
  }
}

function updateTaskState(
  previous: TaskState,
  stage: SessionRecord['taskStage'],
  snapshot: WorkspaceSnapshot,
  deliverablePlan: DeliverablePlan,
  selectedSkill?: SkillRecord,
  toolCalls: ToolCallRecord[] = [],
  latestTool?: ToolName,
  latestResult?: ToolResult,
  contextPack?: ContextPack,
): TaskState {
  void latestTool
  void latestResult

  const inspectedFiles = new Set(previous.inspectedFiles)
  const producedOutputs = new Set(snapshot.outputFiles.map(file => file.name))
  const unsupportedFiles = new Map((previous.unsupportedFiles || []).map(item => [item.name, item.reason]))

  for (const call of toolCalls) {
    if (call.phase === 'execution' && (call.tool === 'inspect_file' || call.tool === 'preview_spreadsheet' || call.tool === 'read_file')) {
      const target = typeof call.input.target === 'string' ? call.input.target : undefined
      const location = typeof call.input.location === 'string' ? call.input.location : undefined
      if (target) inspectedFiles.add(location === 'output' ? `output/${target}` : target)
      if (target && call.success === false) {
        unsupportedFiles.set(location === 'output' ? `output/${target}` : target, call.outputSummary || call.error || '当前文件暂不支持可靠处理')
      }
    }
    if (call.phase === 'execution' && call.tool === 'read_multiple_files' && Array.isArray(call.input.targets)) {
      for (const target of call.input.targets) {
        if (typeof target === 'string') inspectedFiles.add(target)
      }
    }
    for (const artifact of call.artifacts || []) producedOutputs.add(artifact)
  }

  const explorationMode = previous.explorationMode || inferExplorationMode(snapshot, selectedSkill)
  const explorationSummary = inferDocumentExplorationSummary(toolCalls, snapshot, previous.explorationSummary)
  const shouldClearStructuredBlocker = explorationMode === 'documents' && explorationSummary?.likelyDocumentTask === 'vote-statistics'
  const blockers = shouldClearStructuredBlocker
    ? previous.blockers.filter(blocker => blocker !== '缺少结构化输入')
    : previous.blockers

  return {
    stage: stage || previous.stage,
    selectedSkillId: selectedSkill?.id || previous.selectedSkillId,
    selectedSkillName: selectedSkill?.name || previous.selectedSkillName,
    selectedInputs: contextPack?.pinnedFiles?.length
      ? contextPack.pinnedFiles
      : (deliverablePlan.selectedInputs || snapshot.workspaceFiles.map(file => file.name)),
    inspectedFiles: [...inspectedFiles],
    producedOutputs: [...producedOutputs],
    blockers,
    unsupportedFiles: [...unsupportedFiles.entries()].map(([name, reason]) => ({ name, reason })),
    explorationMode,
    explorationSummary,
    pendingClarification: shouldClearStructuredBlocker ? undefined : previous.pendingClarification,
  }
}

function maybeRequireClarification(
  session: SessionRecord,
  userInput: string,
  snapshot: WorkspaceSnapshot,
  deliverablePlan: DeliverablePlan,
  taskState: TaskState,
  selectedSkill?: SkillRecord,
): ClarificationRequest | undefined {
  if (session.clarificationPolicy?.enabled === false) return undefined

  if (!snapshot.workspaceFiles.length) {
    return {
      question: '我还没有看到可处理的输入文件。请先上传相关文件，或者告诉我你希望我直接生成什么内容？',
      reason: '缺少输入文件',
      missingDetails: ['输入文件或明确的纯文本任务目标'],
      options: ['上传文件', '改为直接生成文本/报告'],
    }
  }

  if (selectedSkill?.input_requirements.needs_structured_input && !snapshot.workspaceFiles.some(file => /\.(xlsx?|csv|json)$/i.test(file.name))) {
    const hasExplorableDocuments = taskState.explorationMode === 'documents' && snapshot.workspaceFiles.some(file => /\.docx$/i.test(file.name))
    const hasRecognizedDocumentStrategy = taskState.explorationSummary?.likelyDocumentTask === 'vote-statistics'

    if (hasRecognizedDocumentStrategy) {
      return undefined
    }

    if (hasExplorableDocuments && taskState.inspectedFiles.length < Math.min(snapshot.workspaceFiles.length, 3)) {
      return undefined
    }

    return {
      question: `当前任务更适合结构化输入，但我暂时没有看到合适的表格或 JSON 文件。你要不要上传一个 ${selectedSkill.name} 所需的输入文件？`,
      reason: '缺少结构化输入',
      missingDetails: ['xlsx/csv/json 输入文件'],
      options: ['上传表格文件', '改成文档总结任务'],
    }
  }

  if (/填写|填入|套用|模板|空白位置|表格中|填到/.test(userInput)) {
    const convertedDocxOutput = findConvertedDocxOutput(snapshot) || snapshot.outputFiles.map(file => file.name).find(name => /\.docx$/i.test(name))
    if (convertedDocxOutput) {
      return undefined
    }

    const unsupportedTemplate = (taskState.unsupportedFiles || []).find(item => /\.doc\b/i.test(item.name) || /旧版 Word|暂不支持可靠读取|不支持/.test(item.reason))
    if (unsupportedTemplate) {
      return {
        question: `我已经识别到需要回填的模板文件「${unsupportedTemplate.name}」，但它是当前无法可靠解析的格式，因此不能自动定位空白位置。你可以上传对应的 .docx 模板，或者让我先输出一份可填写字段草稿。`,
        reason: '关键模板文件不可解析',
        missingDetails: ['可编辑的 .docx 模板，或改为接受字段草稿输出'],
        options: ['上传 .docx 模板', '先输出字段草稿'],
      }
    }
  }

  if (/这个|那个|按之前|照旧|同样方式/.test(userInput) && !session.messages.slice(0, -1).some(message => message.role === 'user' && message.content !== userInput)) {
    return {
      question: '你提到了“这个/那个/按之前那样”，但当前上下文还不足以判断具体指的是哪份文件或哪种处理方式。你可以再明确一下目标文件和期望结果吗？',
      reason: '指代不明确',
      missingDetails: ['目标文件', '期望输出'],
    }
  }

  const requiredOutputsMissing = deliverablePlan.outputFiles.filter(item => item.required && item.status === 'missing')
  if (taskState.stage === 'verify_outputs' && requiredOutputsMissing.length === deliverablePlan.outputFiles.filter(item => item.required).length) {
    return {
      question: '我还没有生成出你需要的主交付物。你希望我继续尝试自动处理，还是先告诉你当前卡在哪些字段/文件上？',
      reason: '主交付物尚未生成',
      missingDetails: requiredOutputsMissing.map(item => item.filename),
      options: ['继续自动尝试', '先解释当前阻塞点'],
    }
  }

  return undefined
}

function inferInitialStage(session: SessionRecord): SessionRecord['taskStage'] {
  if (!session.messages.length) return 'understand'
  return 'inspect_files'
}

function deriveNextStage(
  currentStage: SessionRecord['taskStage'],
  tool: ToolName,
  result: ToolResult,
): SessionRecord['taskStage'] {
  if (tool === 'end_turn') return 'complete'
  if (tool === 'observe_workspace' || tool === 'list_workspace_tree') return 'inspect_files'
  if (tool === 'inspect_file' || tool === 'preview_spreadsheet' || tool === 'read_file' || tool === 'read_multiple_files') return 'analyze_structure'
  if (result.createdFile || (result.artifacts && result.artifacts.length)) return 'verify_outputs'
  if (tool === 'write_file' || tool === 'write_markdown_report' || tool === 'write_json_result' || tool === 'copy_workspace_file_to_output' || tool === 'execute_python') {
    return 'produce_outputs'
  }
  return currentStage || 'understand'
}

function canEndTurn(snapshot: WorkspaceSnapshot, toolCalls: ToolCallRecord[], plan?: DeliverablePlan) {
  const outputNames = new Set(snapshot.outputFiles.map(file => file.name))
  const hasCreatedArtifact = toolCalls.some(call => Array.isArray(call.artifacts) && call.artifacts.length > 0)
  const requiredOutputs = (plan?.outputFiles || []).filter(item => item.required)
  const requiredOutputsSatisfied = requiredOutputs.length
    ? requiredOutputs.every(item => outputNames.has(item.filename) || item.status === 'generated')
    : snapshot.outputFiles.some(file => !['task-plan.md', 'final-report.md'].includes(file.name))
  const hasInspectedInput = toolCalls.some(call => ['inspect_file', 'preview_spreadsheet', 'read_file', 'read_multiple_files'].includes(call.tool))
  return requiredOutputsSatisfied && (hasCreatedArtifact || snapshot.outputFiles.length > 0) && hasInspectedInput
}

function extractGeneratedCode(toolCalls: ToolCallRecord[]) {
  const writeCall = [...toolCalls].reverse().find(item =>
    ['write_file', 'write_markdown_report', 'write_json_result'].includes(item.tool),
  )
  if (!writeCall) return undefined
  return typeof writeCall.input.content === 'string'
    ? writeCall.input.content
    : typeof writeCall.input.sections !== 'undefined'
      ? JSON.stringify(writeCall.input, null, 2)
      : undefined
}

function pushLog(logs: ExecutionLog[], step: string, status: ExecutionLog['status'], content: string) {
  logs.push({
    timestamp: new Date().toISOString(),
    step,
    status,
    content,
  })
}
