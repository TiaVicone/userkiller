import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import {
  ensureBaseDirs,
  ensureDir,
  decodePossibleMojibake,
  deletePathWithMcp,
  loadDeepSeekConfig,
  safeJoin,
} from './fsUtils.js'
import { callMcpTool } from './services/mcpService.js'
import { runQueryEngine } from './services/queryEngineService.js'
import { previewSpreadsheet } from './services/spreadsheetService.js'
import {
  appendMessage,
  clearStopRequest,
  createSession,
  deleteSession,
  getSession,
  listSessionFiles,
  listSessions,
  requestStop,
  revertToMessage,
  updateSessionStatus,
} from './services/sessionService.js'
import {
  bumpTemplateUsage,
  createTemplate,
  deleteTemplate as removeTemplate,
  findSimilarTemplates,
  getTemplate,
  listTemplates,
  updateTemplateTags,
} from './services/templateService.js'
import {
  bumpSkillUsage,
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  matchSkills,
  updateSkillTags,
} from './services/skillService.js'
import type { ChatMessage } from './types.js'
import { buildExecutionStatusPayload, getVisibleOutputFiles, isExecutionStatusTerminal } from './executionStatusPayload.js'
import { subscribeExecutionStatus } from './executionStatusEvents.js'
import {
  acquireExecutionLock,
  releaseExecutionLock,
  validateExecuteRequest,
  validateUploadFile,
} from './validation.js'
import { logAudit, getRecentAuditEvents } from './services/auditService.js'
import { authMiddleware, createUser, verifyCredentials, generateTokens, verifyToken, ensureDefaultAdmin } from './middleware/auth.js'
import { globalRateLimiter, executeRateLimiter, uploadRateLimiter, authRateLimiter } from './middleware/rateLimiter.js'
import { safeJoinStrict, assertPathWithinBases, sanitizeFilename } from './middleware/pathSecurity.js'
import { summarizeUsageToday, getSessionTokenUsage, getUserTokenUsageToday } from './services/tokenUsageService.js'

// 导入内部辅助函数用于 /status 端点
function describeTaskStage(stage?: string) {
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

function buildProgressMessage(session: any) {
  const latestLog = session.result?.logs?.at(-1)
  if (latestLog?.content) {
    const cleaned = String(latestLog.content).replace(/^第\s*\d+\s*轮[:：]?/, '').trim()
    return cleaned || describeTaskStage(session.taskStage)
  }
  return describeTaskStage(session.taskStage)
}

function getParamString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}


function openFileInSystem(filePath: string) {
  return new Promise<void>((resolve, reject) => {
    const command = process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open'

    const args = process.platform === 'darwin'
      ? [filePath]
      : process.platform === 'win32'
        ? ['/c', 'start', '', filePath]
        : [filePath]

    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', reject)
    child.unref()
    resolve()
  })
}

const app = express()
const port = Number(process.env.PORT || 5001)

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(process.cwd(), 'data', 'uploads-tmp')
    fs.mkdir(tmpDir, { recursive: true }).then(() => cb(null, tmpDir)).catch(() => cb(null, '/tmp'))
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `${uniqueSuffix}-${file.originalname}`)
  },
})
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
})

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Rewrite /api/v1/* to /api/* (versioned endpoint alias, must be before routes)
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/v1/')) {
    req.url = '/api/' + req.url.slice('/api/v1/'.length)
  }
  next()
})

app.use(globalRateLimiter)

// Auth middleware — enabled when AUTH_ENABLED=1 (default: disabled for backward compat)
const authEnabled = process.env.AUTH_ENABLED === '1'
if (authEnabled) {
  app.use(authMiddleware)
}

// Health check (always open, no auth)
app.get('/api/health', (_req, res) => {
  res.json({ success: true })
})
app.get('/api/v1/health', (_req, res) => {
  res.json({ success: true, version: '1.0.0' })
})

// === Auth routes (canonical paths; /api/v1/auth/* aliases via rewrite) ===
app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' })
  }
  const user = await verifyCredentials(username, password)
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  const tokens = generateTokens(user)
  await logAudit({ sessionId: '', action: 'login', resource: 'auth', result: 'success', details: { username } })
  res.json({ success: true, ...tokens, user: { id: user.id, username: user.username, role: user.role } })
})

app.post('/api/auth/register', authRateLimiter, async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码长度不能少于 6 位' })
  }
  try {
    const user = await createUser(username, password)
    const tokens = generateTokens(user)
    await logAudit({ sessionId: '', action: 'register', resource: 'auth', result: 'success', details: { username } })
    res.json({ success: true, ...tokens, user: { id: user.id, username: user.username, role: user.role } })
  } catch (err: any) {
    res.status(400).json({ error: err.message || '注册失败' })
  }
})

app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body || {}
  if (!refreshToken) {
    return res.status(400).json({ error: '缺少 refreshToken' })
  }
  try {
    const payload = verifyToken(refreshToken)
    res.json({ success: true, accessToken: generateTokens({ id: payload.userId, username: payload.username, role: payload.role } as any).accessToken })
  } catch {
    res.status(401).json({ error: 'refreshToken 无效或已过期' })
  }
})

app.get('/api/sessions', async (_req, res) => {
  const sessions = await listSessions()
  res.json({ sessions })
})

app.post('/api/sessions', async (req, res) => {
  const session = await createSession(req.body?.user_input || '')
  res.json({
    success: true,
    session_id: session.id,
    session_name: session.name,
    workspace_path: session.workspace_path,
    output_path: session.output_path,
  })
})

app.delete('/api/sessions/:sessionId', async (req, res) => {
  await deleteSession(getParamString(req.params.sessionId))
  res.json({ success: true })
})

app.get('/api/sessions/:sessionId/messages', async (req, res) => {
  const session = await getSession(getParamString(req.params.sessionId))
  if (!session) return res.status(404).json({ error: '会话不存在' })
  res.json({ messages: session.messages || [] })
})

app.post('/api/sessions/:sessionId/messages', async (req, res) => {
  const message = req.body?.message as ChatMessage
  const session = await appendMessage(getParamString(req.params.sessionId), message)
  res.json({ success: true, messages: session.messages })
})

app.get('/api/sessions/:sessionId/files', async (req, res) => {
  const session = await getSession(getParamString(req.params.sessionId))
  if (!session) return res.status(404).json({ error: '会话不存在' })

  const [workspace, output] = await Promise.all([
    listSessionFiles(session.workspace_path),
    listSessionFiles(session.output_path),
  ])
  const visibleOutput = getVisibleOutputFiles(output)

  const previews = await Promise.all(workspace.map(async file => {
    if (!/\.xlsx?$/i.test(file.name)) return null
    try {
      const preview = await previewSpreadsheet(file.path)
      return { file: file.name, preview }
    } catch {
      return null
    }
  }))

  res.json({ workspace, output: visibleOutput, previews: previews.filter(Boolean) })
})

app.post('/api/sessions/:sessionId/upload', uploadRateLimiter, upload.single('file'), async (req, res) => {
  const sessionId = getParamString(req.params.sessionId)
  const session = await getSession(sessionId)
  if (!session) return res.status(404).json({ error: '会话不存在' })
  const uploadedFile = Array.isArray(req.file) ? req.file[0] : req.file
  if (!uploadedFile) return res.status(400).json({ error: '未上传文件' })

  const uploadErrors = validateUploadFile({ originalname: uploadedFile.originalname, size: uploadedFile.size })
  if (uploadErrors.length) {
    await fs.unlink(uploadedFile.path).catch(() => {})
    await logAudit({ sessionId, action: 'upload', resource: uploadedFile.originalname, result: 'failure', error: uploadErrors[0].message })
    return res.status(400).json({ error: uploadErrors[0].message, errors: uploadErrors })
  }

  const originalName = Array.isArray(uploadedFile.originalname) ? uploadedFile.originalname[0] : uploadedFile.originalname
  const normalizedName = decodePossibleMojibake(String(originalName || '')).trim()
  if (!normalizedName) {
    await fs.unlink(uploadedFile.path).catch(() => {})
    return res.status(400).json({ error: '文件名无效' })
  }

  try {
    const safeName = sanitizeFilename(normalizedName)
    const target = safeJoinStrict(session.workspace_path, safeName)
    await ensureDir(path.dirname(target))
    await fs.rename(uploadedFile.path, target)
    await logAudit({ sessionId, action: 'upload', resource: safeName, result: 'success', details: { size: uploadedFile.size } })
    res.json({ success: true, filename: safeName, transport: 'local-disk-safe' })
  } catch (err: any) {
    await fs.unlink(uploadedFile.path).catch(() => {})
    res.status(400).json({ error: err.message || '文件保存失败' })
  }
})

app.delete('/api/sessions/:sessionId/files/*', async (req, res) => {
  const session = await getSession(getParamString(req.params.sessionId))
  if (!session) return res.status(404).json({ error: '会话不存在' })

  const wildcard = (req.params as Record<string, string | string[] | undefined>)['0']
  const relativePath = getParamString(wildcard)
  const baseDir = relativePath.startsWith('output/') ? session.output_path : session.workspace_path
  const normalized = relativePath.replace(/^(output|workspace)\//, '')
  try {
    const target = safeJoinStrict(baseDir, normalized)
    assertPathWithinBases(target, [session.workspace_path, session.output_path])
    await deletePathWithMcp(target)
    res.json({ success: true })
  } catch (err: any) {
    res.status(400).json({ error: err.message || '文件删除失败' })
  }
})

app.get('/api/sessions/:sessionId/files/*', async (req, res) => {
  const session = await getSession(getParamString(req.params.sessionId))
  if (!session) return res.status(404).json({ error: '会话不存在' })

  const wildcard = (req.params as Record<string, string | string[] | undefined>)['0']
  const relativePath = getParamString(wildcard)
  const baseDir = relativePath.startsWith('output/') ? session.output_path : session.workspace_path
  const normalized = relativePath.replace(/^(output|workspace)\//, '')
  try {
    const target = safeJoinStrict(baseDir, normalized)
    assertPathWithinBases(target, [session.workspace_path, session.output_path])
    res.sendFile(path.resolve(target))
  } catch (err: any) {
    res.status(400).json({ error: err.message || '文件访问失败' })
  }
})

app.post('/api/sessions/:sessionId/open/*', async (req, res) => {
  const session = await getSession(getParamString(req.params.sessionId))
  if (!session) return res.status(404).json({ error: '会话不存在' })

  const wildcard = (req.params as Record<string, string | string[] | undefined>)['0']
  const relativePath = getParamString(wildcard)
  const baseDir = relativePath.startsWith('output/') ? session.output_path : session.workspace_path
  const normalized = relativePath.replace(/^(output|workspace)\//, '')

  try {
    const target = safeJoinStrict(baseDir, normalized)
    assertPathWithinBases(target, [session.workspace_path, session.output_path])
    await openFileInSystem(path.resolve(target))
    res.json({ success: true, file_path: path.resolve(target) })
  } catch (error) {
    const message = error instanceof Error ? error.message : '打开文件失败'
    res.status(400).json({ success: false, error: message })
  }
})

app.post('/api/sessions/:sessionId/execute', executeRateLimiter, async (req, res) => {
  const sessionId = getParamString(req.params.sessionId)
  const startTime = Date.now()

  const validationErrors = validateExecuteRequest(req.body || {})
  if (validationErrors.length) {
    await logAudit({ sessionId, action: 'execute', resource: 'query', result: 'failure', error: 'validation_failed' })
    return res.status(400).json({ success: false, errors: validationErrors })
  }

  const lock = acquireExecutionLock(sessionId)
  if (!lock.ok) {
    await logAudit({ sessionId, action: 'execute', resource: 'query', result: 'failure', error: 'concurrent_limit' })
    return res.status(429).json({ success: false, error: lock.reason })
  }

  const session = await getSession(sessionId)
  if (!session) {
    releaseExecutionLock(sessionId)
    await logAudit({ sessionId, action: 'execute', resource: 'query', result: 'failure', error: 'session_not_found' })
    return res.status(404).json({ success: false, error: '会话不存在' })
  }

  const userInput = String(req.body?.user_input || '')
  const focusFile = String(req.body?.focus_file || '') || undefined
  const userId = req.user?.userId

  await clearStopRequest(sessionId)
  await updateSessionStatus(sessionId, 'executing', { error: undefined, stopRequested: false })
  await logAudit({ sessionId, action: 'execute', resource: 'query', result: 'success', details: { userInputLength: userInput.length, focusFile, userId } })

  void (async () => {
    try {
      const result = await runQueryEngine({ sessionId, userInput, focusFile, userId })
      const status = result.stopReason === 'stopped' ? 'stopped' : 'completed'
      
      // Persist the assistant completion message to session.messages
      if (result.message) {
        await appendMessage(sessionId, {
          role: 'assistant',
          content: result.message,
          timestamp: new Date().toISOString(),
        })
      }
      
      await updateSessionStatus(sessionId, status, { result, stopRequested: false })
      await logAudit({ sessionId, action: 'execute', resource: 'query_complete', result: 'success', durationMs: Date.now() - startTime, details: { stopReason: result.stopReason } })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      await updateSessionStatus(sessionId, 'error', { error: message, stopRequested: false })
      await logAudit({ sessionId, action: 'execute', resource: 'query_complete', result: 'failure', durationMs: Date.now() - startTime, error: message })
    } finally {
      releaseExecutionLock(sessionId)
    }
  })()

  res.json({ success: true })
})

app.get('/api/sessions/:sessionId/status', async (req, res) => {
  const session = await getSession(getParamString(req.params.sessionId))
  if (!session) return res.status(404).json({ error: '会话不存在' })

  if (session.status === 'completed' || session.status === 'stopped' || session.status === 'awaiting_clarification') {
    const sessionNameUpdated = !!session.messages?.some(message => message.role === 'user' && String(message.content || '').trim())
    return res.json({
      status: 'completed',
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
    })
  }

  if (session.status === 'executing') {
    const progressLogs = session.result?.logs || []
    const progressSteps = session.result?.workflowSteps || []
    return res.json({
      status: 'executing',
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
    })
  }

  if (session.status === 'error') {
    return res.json({ status: 'error', error: session.error || '执行失败' })
  }

  res.json({ status: 'executing' })
})

app.get('/api/sessions/:sessionId/stream', async (req, res) => {
  const sessionId = getParamString(req.params.sessionId)
  const session = await getSession(sessionId)
  if (!session) return res.status(404).json({ error: '会话不存在' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const payload = buildExecutionStatusPayload(session)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)

  // Heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`)
  }, 15000)

  const unsubscribe = subscribeExecutionStatus(sessionId, (updatedSession) => {
    const nextPayload = buildExecutionStatusPayload(updatedSession)
    res.write(`data: ${JSON.stringify(nextPayload)}\n\n`)
    if (isExecutionStatusTerminal(nextPayload)) {
      clearInterval(heartbeat)
      res.end()
    }
  })

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
})

app.post('/api/sessions/:sessionId/stop', async (req, res) => {
  await requestStop(getParamString(req.params.sessionId))
  res.json({ success: true, message: '已请求停止' })
})

app.post('/api/sessions/:sessionId/revert', async (req, res) => {
  const sessionId = getParamString(req.params.sessionId)
  const messageTimestamp = String(req.body?.message_timestamp || '')
  if (!messageTimestamp) return res.status(400).json({ error: '缺少 message_timestamp' })
  try {
    const session = await revertToMessage(sessionId, messageTimestamp)
    await logAudit({ sessionId, action: 'revert', resource: 'message', result: 'success', details: { messageTimestamp } })
    res.json({ success: true, messages: session.messages })
  } catch (err: any) {
    res.status(400).json({ error: err?.message || '回退失败' })
  }
})

app.get('/api/audit', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const events = await getRecentAuditEvents(limit)
  res.json({ events })
})

app.get('/api/usage/today', async (_req, res) => {
  const summary = await summarizeUsageToday()
  res.json({ success: true, summary })
})

app.get('/api/usage/session/:sessionId', async (req, res) => {
  const totalTokens = await getSessionTokenUsage(getParamString(req.params.sessionId))
  res.json({ success: true, sessionId: getParamString(req.params.sessionId), totalTokens })
})

app.get('/api/usage/user/:userId', async (req, res) => {
  const totalTokens = await getUserTokenUsageToday(getParamString(req.params.userId))
  res.json({ success: true, userId: getParamString(req.params.userId), totalTokens })
})

app.get('/api/usage/me', async (req, res) => {
  const userId = req.user?.userId
  if (!userId) {
    return res.json({ success: true, totalTokens: 0, note: '未启用鉴权或未登录' })
  }
  const totalTokens = await getUserTokenUsageToday(userId)
  res.json({ success: true, userId, totalTokens })
})

app.get('/api/skills', async (_req, res) => {
  const skills = await listSkills()
  res.json({ skills })
})

app.get('/api/skills/:skillId', async (req, res) => {
  const skill = await getSkill(getParamString(req.params.skillId))
  if (!skill) return res.status(404).json({ success: false, error: '技能不存在' })
  res.json({ success: true, skill })
})

app.post('/api/skills/match', async (req, res) => {
  const sessionId = String(req.body?.session_id || '')
  const userInput = String(req.body?.user_input || '')
  const session = sessionId ? await getSession(sessionId) : null
  if (!session) return res.status(404).json({ success: false, error: '会话不存在' })
  const workspace = await listSessionFiles(session.workspace_path)
  const result = await matchSkills(userInput, {
    workspaceFiles: workspace.map(file => ({ name: file.name, size: file.size, modifiedAt: file.modified_at })),
    outputFiles: [],
    summary: `workspace 共 ${workspace.length} 个文件`,
  })
  res.json({ success: true, matches: result })
})

app.post('/api/skills', async (req, res) => {
  const skill = await createSkill(req.body || {})
  res.json({ success: true, skill })
})

app.post('/api/skills/:skillId/tags', async (req, res) => {
  const skill = await updateSkillTags(getParamString(req.params.skillId), Array.isArray(req.body?.tags) ? req.body.tags : [])
  if (!skill) return res.status(404).json({ success: false, error: '技能不存在' })
  res.json({ success: true, skill })
})

app.post('/api/skills/:skillId/usage', async (req, res) => {
  await bumpSkillUsage(getParamString(req.params.skillId), typeof req.body?.success === 'boolean' ? req.body.success : undefined)
  res.json({ success: true })
})

app.delete('/api/skills/:skillId', async (req, res) => {
  await deleteSkill(getParamString(req.params.skillId))
  res.json({ success: true })
})

app.get('/api/templates', async (_req, res) => {
  const templates = await listTemplates()
  res.json({ templates })
})

app.get('/api/templates/:templateId', async (req, res) => {
  const template = await getTemplate(getParamString(req.params.templateId))
  if (!template) return res.status(404).json({ success: false, error: '模板不存在' })
  res.json({ success: true, template })
})

app.delete('/api/templates/:templateId', async (req, res) => {
  await removeTemplate(getParamString(req.params.templateId))
  res.json({ success: true })
})

app.post('/api/sessions/:sessionId/save-template', async (req, res) => {
  const session = await getSession(getParamString(req.params.sessionId))
  if (!session) return res.status(404).json({ success: false, error: '会话不存在' })

  const template = await createTemplate({
    name: session.name,
    taskDescription: String(req.body?.task_description || session.name || '未命名模板'),
    code: String(req.body?.code || ''),
    fileInfo: Array.isArray(req.body?.file_info) ? req.body.file_info : [],
    outputFiles: Array.isArray(req.body?.output_files) ? req.body.output_files : [],
  })

  res.json({ success: true, template_id: template.id, template_name: template.name })
})

app.post('/api/sessions/:sessionId/check-similar', async (req, res) => {
  const userInput = String(req.body?.user_input || '')
  const templates = await findSimilarTemplates(userInput)
  res.json({ success: true, templates })
})

app.post('/api/templates/:templateId/execute', async (req, res) => {
  const template = await getTemplate(getParamString(req.params.templateId))
  if (!template) return res.status(404).json({ success: false, error: '模板不存在' })

  const session = await getSession(String(req.body?.session_id || ''))
  if (!session) return res.status(404).json({ success: false, error: '会话不存在' })

  await bumpTemplateUsage(template.id)
  const config = await loadDeepSeekConfig()

  const reusedFiles: string[] = []
  const reportSections = [
    `- 模板描述：${template.description}`,
    `- 原始任务：${template.task_description}`,
    `- 模板标签：${template.tags.join('、') || '无'}`,
  ]

  for (const file of template.output_files || []) {
    const name = String(file.name || file.filename || '')
    if (!name) continue
    const sourcePath = safeJoin(session.output_path, name)
    const sourceExists = await fs.stat(sourcePath).then(() => true).catch(() => false)
    if (sourceExists) {
      const targetPath = safeJoin(session.output_path, `template-reuse-${name}`)
      const readResult = await callMcpTool(config, {
        serverId: 'filesystem',
        toolName: 'read_text_file',
        argumentsPayload: { path: sourcePath },
      })
      await callMcpTool(config, {
        serverId: 'filesystem',
        toolName: 'write_file',
        argumentsPayload: {
          path: targetPath,
          content: readResult.content,
        },
      })
      reusedFiles.push(`template-reuse-${name}`)
    }
  }

  const reportContent = [
    `# 模板执行：${template.name}`,
    '',
    ...reportSections,
    '',
    '## 模板代码/内容',
    '',
    template.code || '暂无代码内容',
    '',
    '## 复用结果文件',
    '',
    ...(reusedFiles.length ? reusedFiles.map(file => `- ${file}`) : ['- 无可直接复用文件，已保留模板说明']),
  ].join('\n')

  const targetPath = safeJoin(session.output_path, 'template-execution.md')
  await callMcpTool(config, {
    serverId: 'filesystem',
    toolName: 'write_file',
    argumentsPayload: {
      path: targetPath,
      content: reportContent,
    },
  })

  res.json({
    success: true,
    message: `已应用模板「${template.name}」，并生成 output/template-execution.md`,
    compatibility_warning: reusedFiles.length ? '' : '当前模板没有可直接复用的输出文件，已生成说明报告供继续执行。',
    session_name_updated: false,
    session_name: session.name,
  })
})

app.post('/api/templates/:templateId/tags', async (req, res) => {
  const tags = Array.isArray(req.body?.tags) ? req.body.tags : []
  const template = await updateTemplateTags(getParamString(req.params.templateId), tags)
  if (!template) return res.status(404).json({ success: false, error: '模板不存在' })
  res.json({ success: true, template })
})



async function bootstrap() {
  await ensureBaseDirs()
  if (authEnabled) {
    await ensureDefaultAdmin()
  }
  app.listen(port, () => {
    console.log(`backend listening on http://localhost:${port}`)
    if (authEnabled) {
      console.log('[auth] Authentication enabled. Set JWT_SECRET in production.')
    } else {
      console.log('[auth] Authentication disabled. Set AUTH_ENABLED=1 to enable.')
    }
  })
}

bootstrap().catch(error => {
  console.error('后端启动失败:', error)
  process.exit(1)
})
