import fs from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, ensureDir } from '../fsUtils.js'

const AUDIT_DIR = path.join(DATA_DIR, 'audit')
const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB per log file

export interface AuditEvent {
  timestamp: string
  sessionId: string
  action: 'execute' | 'upload' | 'download' | 'delete' | 'stop' | 'tool_call' | 'create_session' | 'revert' | 'login' | 'register'
  resource: string
  details?: Record<string, unknown>
  result: 'success' | 'failure'
  durationMs?: number
  error?: string
}

let currentLogFile = ''
let currentLogSize = 0

function getLogFileName(): string {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(AUDIT_DIR, `audit-${date}.jsonl`)
}

export async function logAudit(event: Omit<AuditEvent, 'timestamp'>): Promise<void> {
  try {
    await ensureDir(AUDIT_DIR)

    const fullEvent: AuditEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    }

    const logFile = getLogFileName()
    const line = JSON.stringify(fullEvent) + '\n'

    if (logFile !== currentLogFile) {
      currentLogFile = logFile
      try {
        const stat = await fs.stat(logFile)
        currentLogSize = stat.size
      } catch {
        currentLogSize = 0
      }
    }

    if (currentLogSize > MAX_LOG_SIZE) {
      const rotated = logFile.replace('.jsonl', `-${Date.now()}.jsonl`)
      await fs.rename(logFile, rotated).catch(() => {})
      currentLogSize = 0
    }

    await fs.appendFile(logFile, line, 'utf-8')
    currentLogSize += Buffer.byteLength(line)
  } catch {
    // Audit logging must never block the main flow
  }
}

export async function getRecentAuditEvents(limit = 50): Promise<AuditEvent[]> {
  try {
    await ensureDir(AUDIT_DIR)
    const logFile = getLogFileName()
    const content = await fs.readFile(logFile, 'utf-8').catch(() => '')
    if (!content) return []

    const lines = content.trim().split('\n').filter(Boolean)
    return lines
      .slice(-limit)
      .map(line => {
        try { return JSON.parse(line) as AuditEvent } catch { return null }
      })
      .filter((e): e is AuditEvent => e !== null)
      .reverse()
  } catch {
    return []
  }
}
