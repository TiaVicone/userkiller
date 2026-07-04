import fs from 'node:fs/promises'
import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import {
  ensureDir,
  ensureBaseDirs,
  ensureDirWithMcp,
  deletePathWithMcp,
  decodePossibleMojibake,
  loadDeepSeekConfig,
  normalizeSessionName,
  readJsonFile,
  sessionNameFallback,
  sessionNameFromMessages,
  sessionOutputDir,
  sessionRootDir,
  sessionWorkspaceDir,
  writeJsonFileWithMcp,
} from '../fsUtils.js'
import { emitExecutionStatus } from '../executionStatusEvents.js'
import { callMcpTool } from './mcpService.js'
import { generateSessionName } from './deepseekService.js'
import type {
  AgentExecutionResult,
  ChatMessage,
  ClarificationPolicy,
  DeliverablePlan,
  SessionFileInfo,
  SessionIndexEntry,
  SessionRecord,
  TaskState,
} from '../types.js'

const SESSIONS_INDEX_FILE = path.join(sessionRootDir('__index__'), 'sessions.json')

function sessionFile(sessionId: string) {
  return path.join(sessionRootDir(sessionId), 'session.json')
}

function toSessionIndexEntry(session: SessionRecord): SessionIndexEntry {
  return {
    id: session.id,
    name: session.name,
    created_at: session.created_at,
    workspace_path: session.workspace_path,
    output_path: session.output_path,
    status: session.status,
    taskStage: session.taskStage,
    last_used: session.messages.at(-1)?.timestamp || session.created_at,
  }
}

async function persistSessionIndex(entries: SessionIndexEntry[]) {
  const config = await loadDeepSeekConfig()
  await writeJsonFileWithMcp(SESSIONS_INDEX_FILE, entries, config)
}

async function upsertSessionIndex(session: SessionRecord) {
  const entries = await listSessions()
  const nextEntries = entries.filter(item => item.id !== session.id)
  nextEntries.push(toSessionIndexEntry(session))
  await persistSessionIndex(nextEntries)
}

async function removeSessionIndex(sessionId: string) {
  const entries = await listSessions()
  await persistSessionIndex(entries.filter(item => item.id !== sessionId))
}

export async function listSessions(): Promise<SessionIndexEntry[]> {
  await ensureBaseDirs()
  const sessions = await readJsonFile<SessionIndexEntry[]>(SESSIONS_INDEX_FILE, [])
  return sessions.sort((a, b) => {
    const right = b.last_used || b.created_at
    const left = a.last_used || a.created_at
    return right.localeCompare(left)
  })
}

export async function getSession(sessionId: string): Promise<SessionRecord | null> {
  await ensureBaseDirs()
  const session = await readJsonFile<SessionRecord | null>(sessionFile(sessionId), null)
  return session
}

export async function saveSession(session: SessionRecord) {
  await ensureBaseDirs()
  const config = await loadDeepSeekConfig()
  await writeJsonFileWithMcp(sessionFile(session.id), session, config)
  await upsertSessionIndex(session)
}

export async function createSession(initialInput = ''): Promise<SessionRecord> {
  await ensureBaseDirs()
  const config = await loadDeepSeekConfig()
  const sessionId = uuidv4()
  const createdAt = new Date().toISOString()
  const initialName = normalizeSessionName(initialInput)
  const session: SessionRecord = {
    id: sessionId,
    name: initialName || sessionNameFallback(),
    created_at: createdAt,
    workspace_path: sessionWorkspaceDir(sessionId),
    output_path: sessionOutputDir(sessionId),
    messages: [],
    status: 'idle',
    stopRequested: false,
    contextRecords: [],
    toolCalls: [],
    taskStage: 'understand',
    deliverablePlan: undefined,
    taskState: {
      stage: 'understand',
      selectedInputs: [],
      inspectedFiles: [],
      producedOutputs: [],
      blockers: [],
    },
    clarificationPolicy: {
      enabled: true,
    },
  }

  await ensureDir(session.workspace_path)
  await ensureDir(session.output_path)
  await saveSession(session)
  return session
}

export async function deleteSession(sessionId: string) {
  const root = sessionRootDir(sessionId)
  await deletePathWithMcp(root)
  await removeSessionIndex(sessionId)
}

export async function appendMessage(sessionId: string, message: ChatMessage) {
  const session = await getSession(sessionId)
  if (!session) throw new Error('会话不存在')
  session.messages.push(message)

  const isFirstUserMessage = session.messages.filter(m => m.role === 'user').length === 1
  const shouldGenerateAiName = isFirstUserMessage && message.role === 'user' && message.content.trim()
  
  if (shouldGenerateAiName) {
    try {
      const config = await loadDeepSeekConfig()
      const aiGeneratedName = await generateSessionName(config, message.content)
      if (aiGeneratedName && aiGeneratedName.length >= 2) {
        session.name = aiGeneratedName
      } else {
        const fallbackName = normalizeSessionName(message.content)
        session.name = fallbackName || sessionNameFallback()
      }
    } catch (error) {
      console.error('AI 生成会话名称失败，使用规则命名:', error)
      const fallbackName = normalizeSessionName(message.content)
      session.name = fallbackName || sessionNameFallback()
    }
  }

  await saveSession(session)
  return session
}

export async function updateSessionStatus(
  sessionId: string,
  status: SessionRecord['status'],
  options?: {
    result?: AgentExecutionResult
    error?: string
    stopRequested?: boolean
    taskStage?: SessionRecord['taskStage']
    deliverablePlan?: DeliverablePlan
    taskState?: TaskState
    clarificationPolicy?: ClarificationPolicy
  },
) {
  const session = await getSession(sessionId)
  if (!session) throw new Error('会话不存在')
  session.status = status
  if (options?.result) {
    session.result = options.result
    session.contextRecords = resultContext(session.contextRecords, options.result.contextRecords).slice(-30)
    session.toolCalls = [...session.toolCalls, ...options.result.toolCalls].slice(-60)
    session.taskStage = options.result.taskStage || session.taskStage
    session.deliverablePlan = options.result.deliverablePlan || session.deliverablePlan
    session.taskState = options.result.taskState || session.taskState
  }
  if (typeof options?.error === 'string') session.error = options.error
  if (typeof options?.stopRequested === 'boolean') session.stopRequested = options.stopRequested
  if (typeof options?.taskStage === 'string') session.taskStage = options.taskStage
  if (options?.deliverablePlan) session.deliverablePlan = options.deliverablePlan
  if (options?.taskState) session.taskState = options.taskState
  if (options?.clarificationPolicy) session.clarificationPolicy = options.clarificationPolicy
  await saveSession(session)
  emitExecutionStatus(session)
  return session
}

function resultContext(existing: SessionRecord['contextRecords'], incoming: SessionRecord['contextRecords']) {
  return [...existing, ...incoming]
}

export async function requestStop(sessionId: string) {
  const session = await getSession(sessionId)
  if (!session) throw new Error('会话不存在')
  session.stopRequested = true
  await saveSession(session)
  emitExecutionStatus(session)
}

export async function clearStopRequest(sessionId: string) {
  const session = await getSession(sessionId)
  if (!session) throw new Error('会话不存在')
  session.stopRequested = false
  await saveSession(session)
}

export async function revertToMessage(sessionId: string, messageTimestamp: string) {
  const session = await getSession(sessionId)
  if (!session) throw new Error('会话不存在')

  const messageIndex = session.messages.findIndex(m => m.timestamp === messageTimestamp)
  if (messageIndex === -1) throw new Error('消息不存在')

  session.messages = session.messages.slice(0, messageIndex)
  
  const lastUserMessageTimestamp = session.messages
    .filter(m => m.role === 'user')
    .at(-1)?.timestamp

  if (lastUserMessageTimestamp) {
    session.contextRecords = session.contextRecords.filter(
      r => new Date(r.createdAt) <= new Date(lastUserMessageTimestamp)
    )
    session.toolCalls = session.toolCalls.filter(
      tc => new Date(tc.createdAt) <= new Date(lastUserMessageTimestamp)
    )
  } else {
    session.contextRecords = []
    session.toolCalls = []
  }

  session.status = 'idle'
  session.result = undefined
  session.error = undefined
  session.stopRequested = false

  await saveSession(session)
  emitExecutionStatus(session)
  return session
}

export async function listSessionFiles(dirPath: string): Promise<SessionFileInfo[]> {
  await ensureDir(dirPath)

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const files = await Promise.all(entries
      .filter(entry => entry.isFile())
      .map(async entry => {
        const name = decodePossibleMojibake(entry.name)
        const fullPath = path.join(dirPath, name)
        const stat = await fs.stat(fullPath)
        return {
          name,
          path: fullPath,
          size: stat.size,
          modified_at: stat.mtime.toISOString(),
        }
      }))

    return files.sort((a: SessionFileInfo, b: SessionFileInfo) => a.name.localeCompare(b.name, 'zh-CN'))
  } catch {
    const config = await loadDeepSeekConfig()
    await ensureDirWithMcp(dirPath, config)
    const result = await callMcpTool(config, {
      serverId: 'filesystem',
      toolName: 'list_directory_with_sizes',
      argumentsPayload: {
        path: dirPath,
        sortBy: 'name',
      },
    })

    return result.content
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter((line: string) => line.startsWith('[FILE]'))
      .map((line: string, index: number): SessionFileInfo | null => {
        const match = line.match(/^\[FILE\]\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i)
        if (!match) return null
        const rawName = match[1].trim()
        const name = decodePossibleMojibake(rawName)
        return {
          name,
          path: path.join(dirPath, name),
          size: parseSizeLabel(`${match[2]} ${match[3]}`),
          modified_at: new Date(index).toISOString(),
        }
      })
      .filter((item: SessionFileInfo | null): item is SessionFileInfo => item !== null)
  }
}

export async function findWorkspaceFilePath(session: SessionRecord, requestedName: string) {
  const normalizedRequestedName = decodePossibleMojibake(String(requestedName || '').trim())
  if (!normalizedRequestedName) return null

  const files = await listSessionFiles(session.workspace_path)
  const exactMatch = files.find(file => file.name === normalizedRequestedName)
  if (exactMatch) return exactMatch.path

  const decodedMatch = files.find(file => decodePossibleMojibake(file.name) === normalizedRequestedName)
  if (decodedMatch) return decodedMatch.path

  return null
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
