import fs from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, ensureDir } from '../fsUtils.js'

const USAGE_DIR = path.join(DATA_DIR, 'usage')

export interface TokenUsageRecord {
  timestamp: string
  sessionId: string
  userId?: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  turn?: number
  purpose?: 'tool_decision' | 'session_naming' | 'task_understanding' | 'other'
}

export interface UsageSummary {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  callCount: number
  perSession: Record<string, number>
  perUser: Record<string, number>
}

// Per-user daily budget (tokens). Override via DAILY_TOKEN_BUDGET env var.
const DEFAULT_DAILY_BUDGET = Number(process.env.DAILY_TOKEN_BUDGET || 1_000_000)
// Per-session budget (tokens). Override via SESSION_TOKEN_BUDGET env var.
const DEFAULT_SESSION_BUDGET = Number(process.env.SESSION_TOKEN_BUDGET || 200_000)

function getUsageFileName(): string {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(USAGE_DIR, `usage-${date}.jsonl`)
}

export async function logTokenUsage(record: Omit<TokenUsageRecord, 'timestamp'>): Promise<void> {
  try {
    await ensureDir(USAGE_DIR)
    const full: TokenUsageRecord = { ...record, timestamp: new Date().toISOString() }
    const line = JSON.stringify(full) + '\n'
    await fs.appendFile(getUsageFileName(), line, 'utf-8')
  } catch {
    // Usage logging must never block the main flow
  }
}

async function readTodayUsage(): Promise<TokenUsageRecord[]> {
  try {
    await ensureDir(USAGE_DIR)
    const content = await fs.readFile(getUsageFileName(), 'utf-8').catch(() => '')
    if (!content) return []
    return content.trim().split('\n').filter(Boolean)
      .map(line => {
        try { return JSON.parse(line) as TokenUsageRecord } catch { return null }
      })
      .filter((r): r is TokenUsageRecord => r !== null)
  } catch {
    return []
  }
}

export async function getSessionTokenUsage(sessionId: string): Promise<number> {
  const records = await readTodayUsage()
  return records
    .filter(r => r.sessionId === sessionId)
    .reduce((sum, r) => sum + r.totalTokens, 0)
}

export async function getUserTokenUsageToday(userId: string): Promise<number> {
  const records = await readTodayUsage()
  return records
    .filter(r => r.userId === userId)
    .reduce((sum, r) => sum + r.totalTokens, 0)
}

export interface BudgetCheckResult {
  allowed: boolean
  reason?: string
  usedToday?: number
  dailyBudget?: number
  usedInSession?: number
  sessionBudget?: number
}

export async function checkTokenBudget(params: {
  sessionId: string
  userId?: string
}): Promise<BudgetCheckResult> {
  const sessionBudget = DEFAULT_SESSION_BUDGET
  const dailyBudget = DEFAULT_DAILY_BUDGET

  const usedInSession = await getSessionTokenUsage(params.sessionId)
  if (usedInSession >= sessionBudget) {
    return {
      allowed: false,
      reason: `本次会话已用 ${usedInSession} tokens，超过单会话预算 ${sessionBudget}`,
      usedInSession,
      sessionBudget,
    }
  }

  if (params.userId) {
    const usedToday = await getUserTokenUsageToday(params.userId)
    if (usedToday >= dailyBudget) {
      return {
        allowed: false,
        reason: `今日已用 ${usedToday} tokens，超过每日预算 ${dailyBudget}`,
        usedToday,
        dailyBudget,
      }
    }
    return { allowed: true, usedToday, dailyBudget, usedInSession, sessionBudget }
  }

  return { allowed: true, usedInSession, sessionBudget }
}

export async function summarizeUsageToday(): Promise<UsageSummary> {
  const records = await readTodayUsage()
  const summary: UsageSummary = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    callCount: records.length,
    perSession: {},
    perUser: {},
  }
  for (const r of records) {
    summary.totalPromptTokens += r.promptTokens
    summary.totalCompletionTokens += r.completionTokens
    summary.totalTokens += r.totalTokens
    summary.perSession[r.sessionId] = (summary.perSession[r.sessionId] || 0) + r.totalTokens
    if (r.userId) {
      summary.perUser[r.userId] = (summary.perUser[r.userId] || 0) + r.totalTokens
    }
  }
  return summary
}
