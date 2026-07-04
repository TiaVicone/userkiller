import { apiClient } from './apiClient'
import type {
  Session,
  SessionListResponse,
  SessionCreateResponse,
  MessagesResponse,
  FilesResponse,
  ExecutionStatusResponse,
  TemplateListResponse,
  Template,
  SkillListResponse,
  Skill,
  SkillMatch,
  ExecuteRequest,
  SaveTemplateRequest,
  ChatMessage,
} from '../types'

const API_BASE = '/api'

const SSE_RECONNECT_DELAY = 2000
const SSE_MAX_RETRIES = 5

export function subscribeToSessionStatus(
  sessionId: string,
  onMessage: (payload: ExecutionStatusResponse) => void,
  onError?: (error: Event) => void
): () => void {
  let retries = 0
  let eventSource: EventSource | null = null
  let closed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect() {
    if (closed) return
    const url = `${API_BASE}/sessions/${sessionId}/stream`
    eventSource = new EventSource(url)

    eventSource.onmessage = (event) => {
      retries = 0
      try {
        const payload = JSON.parse(event.data) as ExecutionStatusResponse
        onMessage(payload)
        if (payload.status === 'completed' || payload.status === 'error' || payload.status === 'stopped') {
          cleanup()
        }
      } catch (e) {
        console.error('SSE parse error:', e)
      }
    }

    eventSource.onerror = (event) => {
      eventSource?.close()
      eventSource = null
      if (closed) return

      retries++
      if (retries > SSE_MAX_RETRIES) {
        if (onError) onError(event)
        cleanup()
        return
      }
      reconnectTimer = setTimeout(connect, SSE_RECONNECT_DELAY * retries)
    }
  }

  function cleanup() {
    closed = true
    eventSource?.close()
    eventSource = null
    if (reconnectTimer) clearTimeout(reconnectTimer)
  }

  connect()
  return cleanup
}

/**
 * 会话相关 API
 */
export const sessionApi = {
  /**
   * 获取所有会话列表
   */
  async list(): Promise<Session[]> {
    const response = await apiClient.get<SessionListResponse>('/sessions')
    return response.sessions
  },

  /**
   * 创建新会话
   */
  async create(userInput?: string): Promise<SessionCreateResponse> {
    return apiClient.post<SessionCreateResponse>('/sessions', {
      user_input: userInput || '',
    })
  },

  /**
   * 删除会话
   */
  async delete(sessionId: string): Promise<void> {
    await apiClient.delete(`/sessions/${sessionId}`)
  },

  /**
   * 获取会话消息
   */
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const response = await apiClient.get<MessagesResponse>(
      `/sessions/${sessionId}/messages`
    )
    return response.messages
  },

  /**
   * 添加消息到会话
   */
  async addMessage(
    sessionId: string,
    message: ChatMessage
  ): Promise<ChatMessage[]> {
    const response = await apiClient.post<{ messages: ChatMessage[] }>(
      `/sessions/${sessionId}/messages`,
      { message }
    )
    return response.messages
  },

  /**
   * 获取会话文件列表
   */
  async getFiles(sessionId: string): Promise<FilesResponse> {
    return apiClient.get<FilesResponse>(`/sessions/${sessionId}/files`)
  },

  /**
   * 上传文件到会话工作区
   */
  async uploadFile(
    sessionId: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<{ success: boolean; filename: string }> {
    return apiClient.upload(
      `/sessions/${sessionId}/upload`,
      file,
      onProgress
    )
  },

  /**
   * 删除会话文件
   */
  async deleteFile(sessionId: string, filePath: string): Promise<void> {
    await apiClient.delete(`/sessions/${sessionId}/files/${filePath}`)
  },

  /**
   * 下载会话文件
   */
  async downloadFile(
    sessionId: string,
    filePath: string,
    filename?: string
  ): Promise<void> {
    await apiClient.download(
      `/sessions/${sessionId}/files/${filePath}`,
      filename
    )
  },

  /**
   * 在系统中打开文件
   */
  async openFile(
    sessionId: string,
    filePath: string
  ): Promise<{ success: boolean; file_path: string }> {
    return apiClient.post(`/sessions/${sessionId}/open/${filePath}`)
  },

  /**
   * 执行任务
   */
  async execute(
    sessionId: string,
    request: ExecuteRequest
  ): Promise<{ success: boolean }> {
    return apiClient.post(`/sessions/${sessionId}/execute`, request)
  },

  /**
   * 获取执行状态
   */
  async getStatus(sessionId: string): Promise<ExecutionStatusResponse> {
    return apiClient.get<ExecutionStatusResponse>(
      `/sessions/${sessionId}/status`
    )
  },

  /**
   * 停止执行
   */
  async stop(sessionId: string): Promise<{ success: boolean; message: string }> {
    return apiClient.post(`/sessions/${sessionId}/stop`)
  },

  /**
   * 回退会话到指定消息之前
   */
  async revert(sessionId: string, messageTimestamp: string): Promise<{ success: boolean; messages: ChatMessage[] }> {
    return apiClient.post(`/sessions/${sessionId}/revert`, {
      message_timestamp: messageTimestamp,
    })
  },

  /**
   * 保存为模板
   */
  async saveAsTemplate(
    sessionId: string,
    request: SaveTemplateRequest
  ): Promise<{ success: boolean; template_id: string; template_name: string }> {
    return apiClient.post(`/sessions/${sessionId}/save-template`, request)
  },

  /**
   * 检查相似模板
   */
  async checkSimilarTemplates(
    sessionId: string,
    userInput: string
  ): Promise<{ success: boolean; templates: Template[] }> {
    return apiClient.post(`/sessions/${sessionId}/check-similar`, {
      user_input: userInput,
    })
  },
}

/**
 * 模板相关 API
 */
export const templateApi = {
  /**
   * 获取所有模板
   */
  async list(): Promise<Template[]> {
    const response = await apiClient.get<TemplateListResponse>('/templates')
    return response.templates
  },

  /**
   * 获取单个模板
   */
  async get(templateId: string): Promise<Template> {
    const response = await apiClient.get<{ success: boolean; template: Template }>(
      `/templates/${templateId}`
    )
    return response.template
  },

  /**
   * 删除模板
   */
  async delete(templateId: string): Promise<void> {
    await apiClient.delete(`/templates/${templateId}`)
  },

  /**
   * 执行模板
   */
  async execute(
    templateId: string,
    sessionId: string
  ): Promise<{
    success: boolean
    message: string
    compatibility_warning?: string
    session_name: string
    session_name_updated: boolean
  }> {
    return apiClient.post(`/templates/${templateId}/execute`, {
      session_id: sessionId,
    })
  },

  /**
   * 更新模板标签
   */
  async updateTags(
    templateId: string,
    tags: string[]
  ): Promise<{ success: boolean; template: Template }> {
    return apiClient.post(`/templates/${templateId}/tags`, { tags })
  },
}

/**
 * 技能相关 API
 */
export const skillApi = {
  /**
   * 获取所有技能
   */
  async list(): Promise<Skill[]> {
    const response = await apiClient.get<SkillListResponse>('/skills')
    return response.skills
  },

  /**
   * 获取单个技能
   */
  async get(skillId: string): Promise<Skill> {
    const response = await apiClient.get<{ success: boolean; skill: Skill }>(
      `/skills/${skillId}`
    )
    return response.skill
  },

  /**
   * 创建技能
   */
  async create(skill: Partial<Skill>): Promise<Skill> {
    const response = await apiClient.post<{ success: boolean; skill: Skill }>(
      '/skills',
      skill
    )
    return response.skill
  },

  /**
   * 删除技能
   */
  async delete(skillId: string): Promise<void> {
    await apiClient.delete(`/skills/${skillId}`)
  },

  /**
   * 匹配技能
   */
  async match(
    sessionId: string,
    userInput: string
  ): Promise<SkillMatch[]> {
    const response = await apiClient.post<{
      success: boolean
      matches: SkillMatch[]
    }>('/skills/match', {
      session_id: sessionId,
      user_input: userInput,
    })
    return response.matches
  },

  /**
   * 更新技能标签
   */
  async updateTags(
    skillId: string,
    tags: string[]
  ): Promise<{ success: boolean; skill: Skill }> {
    return apiClient.post(`/skills/${skillId}/tags`, { tags })
  },

  /**
   * 更新技能使用统计
   */
  async updateUsage(
    skillId: string,
    success?: boolean
  ): Promise<{ success: boolean }> {
    return apiClient.post(`/skills/${skillId}/usage`, { success })
  },
}

/**
 * 健康检查
 */
export const healthApi = {
  async check(): Promise<{ success: boolean }> {
    return apiClient.get('/health')
  },
}

// 导出所有 API
export const api = {
  session: sessionApi,
  template: templateApi,
  skill: skillApi,
  health: healthApi,
}

export default api
