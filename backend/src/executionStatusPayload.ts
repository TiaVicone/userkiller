import type { SessionRecord, TaskStage } from './types.js'

function describeTaskStage(stage?: TaskStage) {
  switch (stage) {
    case 'understand':
      return '正在理解你的目标'
    case 'inspect_files':
      return '正在查看相关文件'
    case 'analyze_structure':
      return '正在分析内容结构'
    case 'produce_outputs':
      return '正在生成修改结果'
    case 'verify_outputs':
      return '正在核对输出结果'
    case 'complete':
      return '已完成当前任务'
    default:
      return '正在处理中'
  }
}

function humanizeLogStep(step?: string) {
  switch (step) {
    case 'query-engine':
      return '开始处理任务'
    case 'product-understanding':
      return '理解任务背景'
    case 'collaboration-mode':
      return '应用协作模式'
    case 'agent-decision':
      return '决定下一步动作'
    case 'agent-loop':
      return '执行当前步骤'
    case 'clarification':
      return '等待补充信息'
    default:
      return '执行中'
  }
}

function humanizeWorkflowModule(module?: string) {
  const text = String(module || '')
  if (/^Decision\s+\d+/i.test(text)) return '决定下一步'
  if (/^Agent Loop\s+\d+/i.test(text)) return '执行处理步骤'
  return text || '处理中'
}

function buildProgressMessage(session: SessionRecord) {
  const latestLog = session.result?.logs?.at(-1)
  if (latestLog?.content) {
    const cleaned = String(latestLog.content).replace(/^第\s*\d+\s*轮[:：]?/, '').trim()
    return cleaned || describeTaskStage(session.taskStage)
  }
  return describeTaskStage(session.taskStage)
}

export function isHiddenOutputFile(name: string) {
  return ['task-plan.md', 'final-report.md', 'document-structure-summary.json', 'template-field-mapping.json', 'template-fill-report.json'].includes(name)
}

export function getVisibleOutputFiles(files: Array<{ name: string, path: string, size: number, modified_at: string }>) {
  return files.filter(file => !isHiddenOutputFile(file.name))
}

/** 与 GET /api/sessions/:id/status 返回体一致，供 HTTP 与 SSE 共用 */
export function buildExecutionStatusPayload(session: SessionRecord) {
  if (session.status === 'completed' || session.status === 'stopped' || session.status === 'awaiting_clarification') {
    const sessionNameUpdated = !!session.messages?.some(message => message.role === 'user' && String(message.content || '').trim())
    return {
      status: 'completed' as const,
      result: {
        message: session.result?.message || '执行完成',
        workflow_steps: session.result?.workflowSteps || [],
        logs: session.result?.logs || [],
        success: session.result?.success ?? true,
        generated_code: session.result?.generatedCode,
        task_description: session.result?.taskDescription,
        clarification_request: session.result?.clarificationRequest,
        task_state: session.result?.taskState,
        session_name: session.name,
        session_name_updated: sessionNameUpdated,
      },
    }
  }

  if (session.status === 'executing') {
    const progressLogs = session.result?.logs || []
    const progressSteps = session.result?.workflowSteps || []
    return {
      status: 'executing' as const,
      progress: {
        task_stage: session.taskStage,
        task_stage_label: describeTaskStage(session.taskStage),
        latest_log: progressLogs.at(-1)
          ? {
              ...progressLogs.at(-1),
              step_label: humanizeLogStep(progressLogs.at(-1)?.step),
            }
          : null,
        logs: progressLogs.slice(-8).map(log => ({
          ...log,
          step_label: humanizeLogStep(log.step),
        })),
        workflow_steps: progressSteps.slice(-6).map(step => ({
          ...step,
          module_label: humanizeWorkflowModule(step.module),
        })),
        message: buildProgressMessage(session),
      },
    }
  }

  if (session.status === 'error') {
    return { status: 'error' as const, error: session.error || '执行失败' }
  }

  return { status: 'executing' as const }
}

export function isExecutionStatusTerminal(payload: ReturnType<typeof buildExecutionStatusPayload>) {
  return payload.status === 'completed' || payload.status === 'error'
}
