import fs from 'node:fs/promises'
import path from 'node:path'
import type { DeepSeekConfig, MCPServerConfig } from './types.js'
import { callMcpTool } from './services/mcpService.js'

const DEFAULT_FILESYSTEM_SERVER: MCPServerConfig = {
  id: 'filesystem',
  command: 'node',
  args: ['./node_modules/@modelcontextprotocol/server-filesystem/dist/index.js', '..'],
  cwd: 'backend',
  description: '默认文件系统 MCP 服务，直接使用本地已安装 server-filesystem 并作用于项目工作区根目录',
}

const MOJIBAKE_PATTERN = /[ÃÂ][\x80-\xBF]|[äåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/

export const ROOT_DIR = path.resolve(process.cwd())
export const DATA_DIR = path.join(ROOT_DIR, 'data')
export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions')
export const TEMPLATES_DIR = path.join(DATA_DIR, 'templates')
export const SKILLS_DIR = path.join(DATA_DIR, 'skills')
export const CONFIG_FILE = path.join(ROOT_DIR, 'config.json')

export async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function ensureDirWithMcp(dirPath: string, config?: DeepSeekConfig) {
  const resolvedConfig = config || await loadDeepSeekConfig()
  try {
    await fs.mkdir(dirPath, { recursive: true })
    return
  } catch {
    await callMcpTool(resolvedConfig, {
      serverId: 'filesystem',
      toolName: 'create_directory',
      argumentsPayload: { path: dirPath },
    })
  }
}

export async function ensureBaseDirs() {
  const config = await readJsonFileWithMcp<Partial<DeepSeekConfig>>(CONFIG_FILE, {})
  const hasMcpConfig = !!(config.apiKey || process.env.DEEPSEEK_API_KEY)

  if (hasMcpConfig) {
    await ensureDirWithMcp(DATA_DIR)
    await ensureDirWithMcp(SESSIONS_DIR)
    await ensureDirWithMcp(TEMPLATES_DIR)
    return
  }

  await ensureDir(DATA_DIR)
  await ensureDir(SESSIONS_DIR)
  await ensureDir(TEMPLATES_DIR)
}

export function decodePossibleMojibake(value: string) {
  if (!value || !MOJIBAKE_PATTERN.test(value)) return value

  try {
    return Buffer.from(value, 'latin1').toString('utf8')
  } catch {
    return value
  }
}

export function normalizeSessionName(input: string) {
  const text = input.replace(/\s+/g, ' ').trim()
  if (!text) return ''

  const stripped = text
    .replace(/[：:，,。！？!?.、】【\[\]()（）“”"'`]/g, ' ')
    .replace(/^(请|帮我|麻烦你|想要|需要|我要|给我|请你)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!stripped) return ''

  const segments = stripped
    .split(/[\s、/|_-]+/)
    .map(item => item.trim())
    .filter(Boolean)

  const meaningful = segments.filter(item => item.length >= 2)
  const source = meaningful.length ? meaningful : segments
  const combined = source.join('') || stripped.replace(/\s+/g, '')

  const verbPatterns = [
    { pattern: /调试|排查|修复|报错|错误|异常/, label: '调试修复' },
    { pattern: /重构|整理|优化|改造/, label: '局部重构' },
    { pattern: /解释|说明|分析|看看|理解/, label: '内容解释' },
    { pattern: /修改|更改|调整|更新|改/, label: '内容修改' },
    { pattern: /生成|输出|编写|撰写/, label: '结果生成' },
    { pattern: /统计|汇总|合并/, label: '数据汇总' },
  ]

  const fileMatch = stripped.match(/([\w\u4e00-\u9fa5.-]+\.(?:tsx?|jsx?|py|java|go|rs|cpp|c|json|md|txt|xlsx|xls|csv|docx|doc|pdf))/i)
  const fileBase = fileMatch?.[1]?.replace(/\.[^.]+$/, '') || ''
  const shortFileBase = fileBase.replace(/[\s_-]+/g, '').slice(0, 5)
  const actionLabel = verbPatterns.find(item => item.pattern.test(stripped))?.label || ''

  let candidate = ''
  if (shortFileBase && actionLabel) {
    candidate = `${shortFileBase}${actionLabel}`
  } else if (shortFileBase) {
    candidate = shortFileBase
  } else if (actionLabel) {
    candidate = actionLabel
  } else {
    candidate = combined
      .replace(/^(关于|一个|一些|怎么|如何|继续|现在|这个|那个)/g, '')
      .slice(0, 10)
  }

  candidate = candidate.replace(/\s+/g, '').slice(0, 10)
  if (candidate.length < 7) {
    const padded = combined.replace(/\s+/g, '').slice(0, 10)
    if (padded.length >= candidate.length) {
      candidate = padded
    }
  }

  return candidate.slice(0, 10)
}

export function sessionNameFromMessages(messages: Array<{ role: string; content: string }>) {
  const firstUserMessage = messages.find(message => message.role === 'user' && String(message.content || '').trim())
  if (!firstUserMessage) return ''
  return normalizeSessionName(String(firstUserMessage.content || ''))
}

export function sessionNameFallback() {
  return `新会话 ${new Date().toLocaleString('zh-CN')}`
}

export function sessionWorkspaceDir(sessionId: string) {
  return path.join(SESSIONS_DIR, sessionId, 'workspace')
}

export function sessionOutputDir(sessionId: string) {
  return path.join(SESSIONS_DIR, sessionId, 'output')
}

export function sessionTempDir(sessionId: string) {
  return path.join(SESSIONS_DIR, sessionId, 'temp')
}

export function sessionRootDir(sessionId: string) {
  return path.join(SESSIONS_DIR, sessionId)
}

export function safeJoin(baseDir: string, relativePath: string) {
  const normalized = relativePath.replace(/^\/+/, '')
  const fullPath = path.resolve(baseDir, normalized)
  if (!fullPath.startsWith(path.resolve(baseDir))) {
    throw new Error('非法路径访问')
  }
  return fullPath
}

export async function readJsonFileWithMcp<T>(filePath: string, fallback: T, config?: DeepSeekConfig): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    try {
      const resolvedConfig = config || await loadDeepSeekConfigFromFs()
      const result = await callMcpTool(resolvedConfig, {
        serverId: 'filesystem',
        toolName: 'read_text_file',
        argumentsPayload: { path: filePath },
      })
      return JSON.parse(result.content) as T
    } catch {
      return fallback
    }
  }
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return await readJsonFileWithMcp(filePath, fallback)
  } catch {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(content) as T
    } catch {
      return fallback
    }
  }
}

export async function writeJsonFile(filePath: string, data: unknown) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

export async function writeJsonFileWithMcp(filePath: string, data: unknown, config?: DeepSeekConfig) {
  await ensureDir(path.dirname(filePath))
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return
  } catch {
    const resolvedConfig = config || await loadDeepSeekConfig()
    await ensureDirWithMcp(path.dirname(filePath), resolvedConfig)
    await callMcpTool(resolvedConfig, {
      serverId: 'filesystem',
      toolName: 'write_file',
      argumentsPayload: {
        path: filePath,
        content: JSON.stringify(data, null, 2),
      },
    })
  }
}

export async function deletePathWithMcp(targetPath: string, config?: DeepSeekConfig) {
  try {
    await fs.rm(targetPath, { force: true, recursive: true })
    return
  } catch {
    const resolvedConfig = config || await loadDeepSeekConfig()

    try {
      const listing = await callMcpTool(resolvedConfig, {
        serverId: 'filesystem',
        toolName: 'list_directory',
        argumentsPayload: { path: targetPath },
      })

      const entries = listing.content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)

      for (const entry of entries) {
        const match = entry.match(/^\[(FILE|DIR)\]\s+(.+)$/)
        if (!match) continue
        const childPath = path.join(targetPath, match[2].trim())
        await deletePathWithMcp(childPath, resolvedConfig)
      }

      await fs.rmdir(targetPath)
      return
    } catch {
      await fs.rm(targetPath, { force: true, recursive: true })
    }
  }
}

async function loadDeepSeekConfigFromFs(): Promise<DeepSeekConfig> {
  const fileConfig = await readJsonFileFromFs<Partial<DeepSeekConfig>>(CONFIG_FILE, {})

  const apiKey = process.env.DEEPSEEK_API_KEY || fileConfig.apiKey || ''
  const baseUrl = process.env.DEEPSEEK_BASE_URL || fileConfig.baseUrl || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || fileConfig.model || 'deepseek-chat'
  const maxTurns = Number(process.env.MAX_AGENT_TURNS || fileConfig.maxTurns || 200)
  const mcpServers = Array.isArray(fileConfig.mcpServers) && fileConfig.mcpServers.length
    ? fileConfig.mcpServers
    : [DEFAULT_FILESYSTEM_SERVER]

  if (!apiKey) {
    throw new Error('缺少 DeepSeek API Key，请在 backend/config.json 或环境变量 DEEPSEEK_API_KEY 中配置')
  }

  return {
    apiKey,
    baseUrl,
    model,
    maxTurns,
    mcpServers,
  }
}

async function readJsonFileFromFs<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return fallback
  }
}

let _cachedConfig: DeepSeekConfig | null = null
let _cachedConfigMtime = 0

export async function loadDeepSeekConfig(): Promise<DeepSeekConfig> {
  try {
    const stat = await fs.stat(CONFIG_FILE)
    const mtime = stat.mtimeMs
    if (_cachedConfig && mtime === _cachedConfigMtime) {
      return _cachedConfig
    }
    _cachedConfig = await loadDeepSeekConfigFromFs()
    _cachedConfigMtime = mtime
    return _cachedConfig
  } catch {
    if (_cachedConfig) return _cachedConfig
    return await loadDeepSeekConfigFromFs()
  }
}
