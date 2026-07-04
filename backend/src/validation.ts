const MAX_CONCURRENT_SESSIONS = 5
const MAX_USER_INPUT_LENGTH = 5000
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const ALLOWED_FILE_EXTENSIONS = new Set([
  '.xlsx', '.xls', '.csv', '.json', '.txt', '.md',
  '.docx', '.doc', '.pdf', '.xml', '.html', '.htm',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg',
])

const executingSessions = new Map<string, { startedAt: number }>()

export function acquireExecutionLock(sessionId: string): { ok: boolean; reason?: string } {
  if (executingSessions.has(sessionId)) {
    return { ok: false, reason: '该会话已有任务正在执行，请等待完成或停止后再试' }
  }

  const activeCount = executingSessions.size
  if (activeCount >= MAX_CONCURRENT_SESSIONS) {
    return { ok: false, reason: `系统并发上限为 ${MAX_CONCURRENT_SESSIONS}，当前已满载，请稍后再试` }
  }

  executingSessions.set(sessionId, { startedAt: Date.now() })
  return { ok: true }
}

export function releaseExecutionLock(sessionId: string) {
  executingSessions.delete(sessionId)
}

export function getActiveSessionCount(): number {
  return executingSessions.size
}

export interface ValidationError {
  field: string
  message: string
}

export function validateExecuteRequest(body: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  const userInput = body?.user_input

  if (typeof userInput !== 'string' || !userInput.trim()) {
    errors.push({ field: 'user_input', message: '请输入任务描述' })
  } else if (userInput.length > MAX_USER_INPUT_LENGTH) {
    errors.push({ field: 'user_input', message: `输入内容不能超过 ${MAX_USER_INPUT_LENGTH} 字符` })
  }

  return errors
}

export function validateUploadFile(file: { originalname: string; size: number }): ValidationError[] {
  const errors: ValidationError[] = []
  const name = String(file.originalname || '').trim()

  if (!name) {
    errors.push({ field: 'file', message: '文件名不能为空' })
    return errors
  }

  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    errors.push({ field: 'file', message: '文件名包含非法路径字符' })
  }

  if (name.length > 255) {
    errors.push({ field: 'file', message: '文件名不能超过 255 个字符' })
  }

  const ext = name.includes('.') ? ('.' + name.split('.').pop()!.toLowerCase()) : ''
  if (ext && !ALLOWED_FILE_EXTENSIONS.has(ext)) {
    errors.push({ field: 'file', message: `不支持的文件类型：${ext}` })
  }

  if (file.size > MAX_FILE_SIZE) {
    errors.push({ field: 'file', message: `文件大小不能超过 ${MAX_FILE_SIZE / 1024 / 1024}MB` })
  }

  return errors
}

export function validateSessionId(sessionId: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    errors.push({ field: 'sessionId', message: '会话 ID 不能为空' })
  } else if (!/^[a-f0-9-]{36}$/i.test(sessionId)) {
    errors.push({ field: 'sessionId', message: '会话 ID 格式无效' })
  }
  return errors
}
