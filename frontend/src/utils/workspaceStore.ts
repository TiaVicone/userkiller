// TODO: 可替换为模型分类 —— 当前为纯前端规则实现（adapter 形式），
// 后续可将 classifySession / extractWorkspaceMemory 替换为模型调用而无需改动调用方。
import type { Session, FileInfo, ChatMessage } from '../types'

/* ═══════════ 数据模型（纯前端，localStorage） ═══════════ */

export interface Workspace {
  id: string
  name: string
  tags: string[]
  sessionIds: string[]
}

export interface Classification {
  workspaceId: string
  reason: string
}

export interface ClassifyResult {
  workspaceId?: string
  newWorkspace?: { name: string; tags: string[] }
  reason: string
}

const WS_KEY = 'uk.workspaces'
const CLS_KEY = 'uk.classifications'
const MIGRATED_KEY = 'uk.workspaces.migrated'
const THEME_KEY = 'uk.theme'
const SNIPPET_KEY = 'uk.snippets'

let version = 0
const listeners = new Set<() => void>()
/** 本次运行内新完成归类的会话（用于「归类横幅」只展示一次） */
const freshSessions = new Set<string>()

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存储不可用时静默降级 */
  }
}

function notify() {
  version++
  listeners.forEach(l => l())
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getVersion(): number {
  return version
}

export function getWorkspaces(): Workspace[] {
  return read<Workspace[]>(WS_KEY, [])
}

function saveWorkspaces(list: Workspace[]) {
  write(WS_KEY, list)
}

function getClassifications(): Record<string, Classification> {
  return read<Record<string, Classification>>(CLS_KEY, {})
}

export function getClassification(sessionId: string): Classification | null {
  return getClassifications()[sessionId] || null
}

export function isFreshClassification(sessionId: string): boolean {
  return freshSessions.has(sessionId)
}

export function acknowledgeClassification(sessionId: string) {
  freshSessions.delete(sessionId)
  notify()
}

export function workspaceOf(sessionId: string): Workspace | null {
  return getWorkspaces().find(w => w.sessionIds.includes(sessionId)) || null
}

/* ═══════════ 关键词 / 标签抽取（规则版） ═══════════ */

const STOPWORDS = new Set([
  '帮我', '请把', '这个', '那个', '一下', '然后', '并且', '以及', '需要', '进行',
  '文件', '数据', '处理', '生成', '所有', '每个', '里面', '内容', '要求', '结果',
  '我的', '你的', '可以', '如何', '怎么', '什么', '就是', '还有', '这些', '那些',
])

const EXT_TAG: Record<string, string> = {
  xlsx: '#Excel', xls: '#Excel', csv: '#CSV',
  docx: '#Word', doc: '#Word', pdf: '#PDF',
  png: '#图片', jpg: '#图片', jpeg: '#图片', gif: '#图片',
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** 从文本中抽关键词（2-6 字中文词 / 英文词），不依赖任何写死候选名单 */
function extractKeywords(text: string, max: number): string[] {
  const tokens = text
    .split(/[\s，。；、！？!?,.:：()（）「」【】\[\]"'’“”\/\\\-—_=+*<>|·]+/)
    .filter(Boolean)
  const out: string[] = []
  for (const raw of tokens) {
    let t = raw
    // 去掉常见动词前缀，保留名词性主干
    t = t.replace(/^(帮我|请|把|将|给|对|按|用|做|要|想)+/, '')
    // 中文取 2-6 字主干；英文数字词保持原样（限长）
    if (/^[一-龥]+$/.test(t)) {
      if (t.length > 6) t = t.slice(0, 6)
      if (t.length < 2) continue
    } else if (/^[A-Za-z][A-Za-z0-9]{1,11}$/.test(t)) {
      // 英文词
    } else {
      continue
    }
    if (STOPWORDS.has(t)) continue
    if (!out.includes(t)) out.push(t)
    if (out.length >= max) break
  }
  return out
}

/**
 * 归类函数（规则版 adapter）。
 * 规则：文件扩展名 + 首条消息关键词，与既有工作区标签重合度 ≥ 阈值则归入；
 * 有相关性但不足以归属 → 继承相关标签新建；否则独立新建。
 */
export function classifySession(
  session: Session,
  files: FileInfo[],
  firstMessage: string
): ClassifyResult {
  const typeTags = Array.from(
    new Set(files.map(f => EXT_TAG[extOf(f.name)]).filter(Boolean))
  ) as string[]
  const text = `${firstMessage || ''} ${session.name || ''}`.trim()
  const keywords = extractKeywords(text, 3)
  const keywordTags = keywords.map(k => `#${k}`)
  const candidateTags = Array.from(new Set([...keywordTags, ...typeTags]))

  const workspaces = getWorkspaces()
  let best: Workspace | null = null
  let bestShared: string[] = []
  for (const ws of workspaces) {
    const shared = ws.tags.filter(t => candidateTags.includes(t))
    if (shared.length > bestShared.length) {
      best = ws
      bestShared = shared
    }
  }

  const fileHint = files.length > 0 ? `涉及 ${files[0].name}` : keywords.length > 0 ? `关键词「${keywords[0]}」` : '暂无明显特征'

  if (best && bestShared.length >= 2) {
    return {
      workspaceId: best.id,
      reason: `${fileHint}，与标签 ${bestShared.join(' ')} 高度相关`,
    }
  }

  const name =
    keywords[0] ||
    (session.name || '').slice(0, 8) ||
    '新工作区'
  const tags = candidateTags.slice(0, 4)

  if (best && bestShared.length === 1) {
    return {
      newWorkspace: { name, tags: Array.from(new Set([...bestShared, ...tags])).slice(0, 4) },
      reason: `${fileHint}，与「${best.name}」部分相关（继承标签 ${bestShared.join(' ')}），已独立建区`,
    }
  }

  return {
    newWorkspace: { name, tags },
    reason: tags.length > 0 ? `${fileHint}，按标签 ${tags.join(' ')} 新建工作区` : `${fileHint}，已新建独立工作区`,
  }
}

/* ═══════════ 工作区读写操作 ═══════════ */

function makeWorkspaceId(): string {
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function detachSession(list: Workspace[], sessionId: string): Workspace[] {
  return list
    .map(w => ({ ...w, sessionIds: w.sessionIds.filter(id => id !== sessionId) }))
    .filter(w => w.sessionIds.length > 0)
}

function applyClassification(sessionId: string, result: ClassifyResult): Classification {
  let list = detachSession(getWorkspaces(), sessionId)
  let wsId = result.workspaceId
  if (!wsId) {
    const nw: Workspace = {
      id: makeWorkspaceId(),
      name: result.newWorkspace?.name || '新工作区',
      tags: result.newWorkspace?.tags || [],
      sessionIds: [],
    }
    list = [...list, nw]
    wsId = nw.id
  }
  list = list.map(w => (w.id === wsId ? { ...w, sessionIds: [...w.sessionIds, sessionId] } : w))
  saveWorkspaces(list)
  const cls: Classification = { workspaceId: wsId, reason: result.reason }
  const all = getClassifications()
  all[sessionId] = cls
  write(CLS_KEY, all)
  return cls
}

/** 若会话尚未归属任何工作区，则归类之（返回是否发生了新归类） */
export function ensureClassified(
  session: Session,
  files: FileInfo[],
  firstMessage: string
): boolean {
  if (workspaceOf(session.id)) return false
  const result = classifySession(session, files, firstMessage)
  applyClassification(session.id, result)
  freshSessions.add(session.id)
  notify()
  return true
}

/** 首次启动：对存量会话做一次批量归类（不弹横幅） */
export function migrateExistingSessions(sessions: Session[]) {
  if (read<boolean>(MIGRATED_KEY, false)) return
  for (const s of sessions) {
    if (!workspaceOf(s.id)) {
      applyClassification(s.id, classifySession(s, [], ''))
    }
  }
  write(MIGRATED_KEY, true)
  notify()
}

/** 手动移动会话到指定工作区（归类横幅「移动」） */
export function moveSessionToWorkspace(sessionId: string, workspaceId: string) {
  let list = detachSession(getWorkspaces(), sessionId)
  list = list.map(w => (w.id === workspaceId ? { ...w, sessionIds: [...w.sessionIds, sessionId] } : w))
  saveWorkspaces(list)
  const all = getClassifications()
  const target = list.find(w => w.id === workspaceId)
  all[sessionId] = { workspaceId, reason: `手动移动到「${target?.name || ''}」` }
  write(CLS_KEY, all)
  freshSessions.delete(sessionId)
  notify()
}

/** 归类横幅「独立新建」：为该会话新建工作区并迁移 */
export function extractToNewWorkspace(sessionId: string, session: Session | null) {
  const old = workspaceOf(sessionId)
  const name = (session?.name || '').slice(0, 8) || '新工作区'
  const tags = old ? old.tags.slice(0, 2) : []
  applyClassification(sessionId, { newWorkspace: { name, tags }, reason: '手动独立新建' })
  freshSessions.delete(sessionId)
  notify()
}

/** 会话被删除时同步清理 */
export function removeSession(sessionId: string) {
  saveWorkspaces(detachSession(getWorkspaces(), sessionId))
  const all = getClassifications()
  delete all[sessionId]
  write(CLS_KEY, all)
  freshSessions.delete(sessionId)
  notify()
}

/* ═══════════ 工作区记忆 adapter（规则抽取版） ═══════════ */

/**
 * 从历史完成对话中抽取「口径 / 约束」类记忆。
 * 规则：会话中存在成功的助手回复时，扫描用户消息里的约束表述。
 * 抽不到则返回空数组（UI 不渲染）。
 */
export function extractWorkspaceMemory(messages: ChatMessage[]): string[] {
  const hasSuccess = messages.some(m => m.role === 'assistant' && m.success)
  if (!hasSuccess) return []
  const patterns = [
    /(?:只|仅)(?:算|统计|保留|计|取|要)[^，。；！？!?\n]{1,18}/g,
    /排除[^，。；！？!?\n]{1,14}/g,
    /保留\s*\d+\s*位小数/g,
    /按[^，。；！?!\n]{1,10}(?:汇总|统计|分组|排序|拆分)/g,
    /(?:以|用)[^，。；\n]{1,10}为准/g,
  ]
  const found: string[] = []
  for (const m of messages) {
    if (m.role !== 'user' || !m.content) continue
    for (const p of patterns) {
      const matches = m.content.match(p)
      if (matches) {
        for (const hit of matches) {
          const clean = hit.trim()
          if (clean && !found.includes(clean)) found.push(clean)
        }
      }
    }
  }
  return found.slice(0, 2)
}

/* ═══════════ 主题 ═══════════ */

export type ThemeName = 'dark' | 'light'

export function getTheme(): ThemeName {
  const t = read<string>(THEME_KEY, 'dark')
  return t === 'light' ? 'light' : 'dark'
}

export function setTheme(theme: ThemeName) {
  write(THEME_KEY, theme)
  document.body.dataset.theme = theme
  notify()
}

/* ═══════════ 会话摘要缓存（⌘K 查找器用） ═══════════ */

export function getSnippet(sessionId: string): string | null {
  const all = read<Record<string, string>>(SNIPPET_KEY, {})
  return all[sessionId] ?? null
}

export function setSnippet(sessionId: string, text: string) {
  const all = read<Record<string, string>>(SNIPPET_KEY, {})
  if (all[sessionId] === text) return
  all[sessionId] = text.slice(0, 60)
  write(SNIPPET_KEY, all)
  notify()
}

/** 工作区色点：从固定视觉色板按 id 稳定取色（CSS 变量，无硬编码 hex） */
const DOT_PALETTE = [
  'var(--xlsx)',
  'var(--docx)',
  'var(--img)',
  'var(--csv)',
  'var(--role-read)',
  'var(--role-decide)',
]

export function workspaceDot(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return DOT_PALETTE[h % DOT_PALETTE.length]
}
