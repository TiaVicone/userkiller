import axios from 'axios'

const API_BASE_URL = '/api'

export const api = {
  // 会话相关
  getSessions: async () => {
    const response = await axios.get(`${API_BASE_URL}/sessions`)
    return response.data
  },

  createSession: async (userInput) => {
    const response = await axios.post(`${API_BASE_URL}/sessions`, { user_input: userInput })
    return response.data
  },

  deleteSession: async (sessionId) => {
    const response = await axios.delete(`${API_BASE_URL}/sessions/${sessionId}`)
    return response.data
  },

  // 文件相关
  getSessionFiles: async (sessionId) => {
    const response = await axios.get(`${API_BASE_URL}/sessions/${sessionId}/files`)
    return response.data
  },

  uploadFile: async (sessionId, file) => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await axios.post(`${API_BASE_URL}/sessions/${sessionId}/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
    return response.data
  },

  deleteFile: async (sessionId, filepath) => {
    const response = await axios.delete(`${API_BASE_URL}/sessions/${sessionId}/files/${filepath}`)
    return response.data
  },

  downloadFile: async (sessionId, filepath) => {
    const response = await axios.get(`${API_BASE_URL}/sessions/${sessionId}/files/${filepath}`, {
      responseType: 'blob'
    })
    return response.data
  },

  // 消息相关
  getMessages: async (sessionId) => {
    const response = await axios.get(`${API_BASE_URL}/sessions/${sessionId}/messages`)
    return response.data
  },

  addMessage: async (sessionId, message) => {
    const response = await axios.post(`${API_BASE_URL}/sessions/${sessionId}/messages`, { message })
    return response.data
  },

  // 工作流执行
  executeWorkflow: async (sessionId, userInput) => {
    const response = await axios.post(`${API_BASE_URL}/sessions/${sessionId}/execute`, { user_input: userInput })
    return response.data
  },

  // 获取执行状态
  getExecutionStatus: async (sessionId) => {
    const response = await axios.get(`${API_BASE_URL}/sessions/${sessionId}/status`)
    return response.data
  },

  // 模板管理
  getTemplates: async () => {
    const response = await axios.get(`${API_BASE_URL}/templates`)
    return response.data
  },

  getTemplate: async (templateId) => {
    const response = await axios.get(`${API_BASE_URL}/templates/${templateId}`)
    return response.data
  },

  deleteTemplate: async (templateId) => {
    const response = await axios.delete(`${API_BASE_URL}/templates/${templateId}`)
    return response.data
  },

  saveAsTemplate: async (sessionId, taskDescription, code, fileInfo, outputFiles) => {
    const response = await axios.post(`${API_BASE_URL}/sessions/${sessionId}/save-template`, {
      task_description: taskDescription,
      code: code,
      file_info: fileInfo,
      output_files: outputFiles
    })
    return response.data
  },

  checkSimilarTemplates: async (sessionId, userInput) => {
    const response = await axios.post(`${API_BASE_URL}/sessions/${sessionId}/check-similar`, {
      user_input: userInput
    })
    return response.data
  },

  executeTemplate: async (templateId, sessionId) => {
    const response = await axios.post(`${API_BASE_URL}/templates/${templateId}/execute`, {
      session_id: sessionId
    })
    return response.data
  },

  addTemplateTags: async (templateId, tags) => {
    const response = await axios.post(`${API_BASE_URL}/templates/${templateId}/tags`, {
      tags: tags
    })
    return response.data
  },

  // 打开文件
  openFile: async (sessionId, filepath) => {
    const response = await axios.post(`${API_BASE_URL}/sessions/${sessionId}/open/${filepath}`)
    return response.data
  }
}

