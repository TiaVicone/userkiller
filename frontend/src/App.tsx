import { useState, useEffect, useMemo, useRef } from 'react'
import TitleBar from './components/TitleBar'
import WorkspaceSidebar from './components/WorkspaceSidebar'
import WorkspacePanel from './components/WorkspacePanel'
import WorkHeader from './components/WorkHeader'
import Observatory from './components/Observatory'
import ChatView from './components/ChatView'
import ConvoFinder from './components/ConvoFinder'
import TemplateLibrary from './components/TemplateLibrary'
import ToastContainer from './components/ToastContainer'
import api, { subscribeToSessionStatus } from './utils/api'
import { showToast } from './utils/toast'
import {
  ensureClassified,
  migrateExistingSessions,
  removeSession,
  setSnippet,
  getTheme,
  setTheme,
  type ThemeName,
} from './utils/workspaceStore'
import { deriveObservatory } from './utils/observatoryModel'
import type { Session, ChatMessage, FileInfo, ActivityStep, ExecutionStatusResponse } from './types'
import './App.css'

// 首帧前应用持久化主题，避免无主题变量的闪烁
document.body.dataset.theme = getTheme()

interface SessionDataCache {
  workspaceFiles: FileInfo[]
  outputFiles: FileInfo[]
  messages: ChatMessage[]
}

interface SendMessageOptions {
  focusFile?: string
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSession, setCurrentSession] = useState<Session | null>(null)
  const [workspaceFiles, setWorkspaceFiles] = useState<FileInfo[]>([])
  const [outputFiles, setOutputFiles] = useState<FileInfo[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const sessionDataCache = useRef<Map<string, SessionDataCache>>(new Map())
  const [focusedFile, setFocusedFile] = useState('')
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false)
  const [templateMode, setTemplateMode] = useState<'modal' | 'sidebar'>('modal')
  const sseCleanupRef = useRef<Record<string, () => void>>({})
  // ── 新增 UI 状态（仅展示层，不触碰执行流） ──
  const [mode, setMode] = useState<'obs' | 'chat'>('obs')
  const [filesOpen, setFilesOpen] = useState(false)
  const [finderOpen, setFinderOpen] = useState(false)
  const [theme, setThemeState] = useState<ThemeName>(getTheme())

  useEffect(() => {
    loadSessions()
  }, [])

  const previousSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (currentSession) {
      const isSameSession = previousSessionIdRef.current === currentSession.id
      previousSessionIdRef.current = currentSession.id

      const cached = sessionDataCache.current.get(currentSession.id)
      if (cached) {
        setWorkspaceFiles(cached.workspaceFiles || [])
        setOutputFiles(cached.outputFiles || [])
        setMessages(cached.messages || [])
      }
      
      // Only fetch from server when switching to a different session
      // When just updating the same session (e.g., name change), use cached data
      if (!isSameSession) {
        void loadSessionData(currentSession.id)
      }
    }
  }, [currentSession])
  
  useEffect(() => {
    return () => {
      Object.values(sseCleanupRef.current).forEach(cleanup => cleanup())
    }
  }, [])
  
  useEffect(() => {
    const savedMode = localStorage.getItem('templateMode')
    if (savedMode === 'sidebar') {
      setTemplateMode('sidebar')
      setShowTemplateLibrary(true)
    }
  }, [])
  
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault()
        if (templateMode === 'modal') {
          setShowTemplateLibrary(prev => !prev)
        }
      }
    }
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [templateMode])

  // ⌘K / Ctrl+K 开关对话查找器，Esc 关闭
  useEffect(() => {
    const handleFinderKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setFinderOpen(prev => !prev)
      }
      if (e.key === 'Escape') {
        setFinderOpen(false)
      }
    }
    window.addEventListener('keydown', handleFinderKey)
    return () => window.removeEventListener('keydown', handleFinderKey)
  }, [])

  // 首次启动：对存量会话做一次批量归类（内部有防重入标记）
  useEffect(() => {
    if (sessions.length > 0) migrateExistingSessions(sessions)
  }, [sessions])

  // 新会话发送首条消息后自动归类（已归属的会话直接跳过），并缓存摘要供 ⌘K 查找器搜索
  useEffect(() => {
    if (!currentSession) return
    const firstUser = messages.find(m => m.role === 'user')
    if (!firstUser?.content) return
    setSnippet(currentSession.id, firstUser.content)
    ensureClassified(currentSession, workspaceFiles, firstUser.content)
  }, [currentSession, messages, workspaceFiles])

  // 观测台 ⇄ 对话切换：文件面板联动（切观测台自动收起、切对话自动展开；手动操作在下次切换前优先）
  const handleSetMode = (next: 'obs' | 'chat') => {
    setMode(next)
    setFilesOpen(next === 'chat')
  }

  const handleToggleTheme = () => {
    const next: ThemeName = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  const loadSessions = async () => {
    try {
      const sessions = await api.session.list()
      setSessions(sessions)
    } catch (error) {
      console.error('加载会话失败:', error)
    }
  }

  const loadSessionData = async (sessionId: string) => {
    try {
      const [fileData, serverMessages] = await Promise.all([
        api.session.getFiles(sessionId),
        api.session.getMessages(sessionId),
      ])
      
      const nextData: SessionDataCache = {
        workspaceFiles: fileData.workspace || [],
        outputFiles: fileData.output || [],
        messages: serverMessages || [],
      }
      sessionDataCache.current.set(sessionId, nextData)
      if (currentSession?.id === sessionId) {
        setWorkspaceFiles(nextData.workspaceFiles)
        setOutputFiles(nextData.outputFiles)
        setMessages(nextData.messages)
      }
    } catch (error) {
      console.error('加载会话数据失败:', error)
    }
  }

  const loadSessionFiles = async (sessionId: string) => {
    try {
      const data = await api.session.getFiles(sessionId)
      const output = data.output || []
      const workspace = data.workspace || []
      setWorkspaceFiles(workspace)
      setOutputFiles(output)
      const cached = sessionDataCache.current.get(sessionId) || {
        workspaceFiles: [],
        outputFiles: [],
        messages: [],
      }
      sessionDataCache.current.set(sessionId, { ...cached, workspaceFiles: workspace, outputFiles: output })
    } catch (error) {
      console.error('加载文件失败:', error)
    }
  }

  const handleCreateSession = async () => {
    try {
      const data = await api.session.create('')
      const newSession: Session = {
        id: data.session_id,
        name: data.session_name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'idle',
        workspace_path: data.workspace_path,
        output_path: data.output_path
      }
      setSessions(prev => [...prev, newSession])
      setCurrentSession(newSession)
      setMessages([])
      setWorkspaceFiles([])
      setOutputFiles([])
      handleSetMode('chat')
    } catch (error: any) {
      console.error('创建会话失败:', error)
      showToast('error', '创建会话失败: ' + (error?.message || '未知错误'))
    }
  }

  const handleDeleteSession = async (sessionId: string) => {
    if (!window.confirm('确定删除该会话吗？此操作不可撤销。')) return
    try {
      await api.session.delete(sessionId)
      removeSession(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      if (currentSession?.id === sessionId) {
        setCurrentSession(null)
        setWorkspaceFiles([])
        setOutputFiles([])
        setMessages([])
      }
      showToast('success', '会话已删除')
    } catch (error: any) {
      console.error('删除会话失败:', error)
      showToast('error', '删除会话失败: ' + (error?.message || '未知错误'))
    }
  }

  const handleSelectSession = (session: Session) => {
    setCurrentSession(session)
    setFocusedFile('')
    handleSetMode('chat')
  }

  const handleUploadFile = async (file: File) => {
    if (!currentSession) return
    try {
      await api.session.uploadFile(currentSession.id, file)
      await loadSessionFiles(currentSession.id)
      showToast('success', `已上传 ${file.name}`)
    } catch (error: any) {
      console.error('上传文件失败:', error)
      showToast('error', '上传文件失败: ' + (error?.message || '未知错误'))
    }
  }

  const handleDeleteFile = async (filepath: string) => {
    if (!currentSession) return
    try {
      await api.session.deleteFile(currentSession.id, filepath)
      await loadSessionFiles(currentSession.id)
    } catch (error) {
      console.error('删除文件失败:', error)
    }
  }

  const handleSendMessage = async (userInput: string, options: SendMessageOptions = {}) => {
    if (!currentSession) {
      try {
        const data = await api.session.create('')
        const newSession: Session = {
          id: data.session_id,
          name: data.session_name,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: 'idle',
          workspace_path: data.workspace_path,
          output_path: data.output_path
        }
        setSessions(prev => [...prev, newSession])
        setCurrentSession(newSession)
        setMessages([])
        setWorkspaceFiles([])
        setOutputFiles([])
        await sendMessageToSession(newSession.id, userInput, options)
      } catch (error) {
        console.error('创建会话失败:', error)
        showToast('error', '创建会话失败，请重试')
      }
      return
    }
    await sendMessageToSession(currentSession.id, userInput, options)
  }

  const handleStopExecution = async (sessionId: string) => {
    try {
      await api.session.stop(sessionId)

      if (sseCleanupRef.current[sessionId]) {
        sseCleanupRef.current[sessionId]()
        delete sseCleanupRef.current[sessionId]
      }

      setMessages(prev => {
        const filtered = prev.filter(m => !m.loading)
        return [
          ...filtered,
          {
            role: 'assistant',
            content: '任务已被用户停止',
            timestamp: new Date().toISOString(),
            success: false,
          },
        ]
      })

      await loadSessionFiles(sessionId)
      showToast('info', '任务已停止')
    } catch (error) {
      console.error('停止任务失败:', error)
      showToast('error', '停止任务失败')
    }
  }

  const handleRevertToMessage = async (messageTimestamp: string) => {
    if (!currentSession) return

    const confirmRevert = window.confirm('确定要回退到此消息之前的状态吗？这将删除该消息及之后的所有对话和执行记录。')
    if (!confirmRevert) return

    try {
      const result = await api.session.revert(currentSession.id, messageTimestamp)
      setMessages(result.messages)
      await loadSessionFiles(currentSession.id)
      await loadSessions()
      showToast('success', '已回退到指定位置')
    } catch (error: any) {
      console.error('回退失败:', error)
      showToast('error', error?.response?.data?.error || '回退失败，请重试')
    }
  }

  const handleSaveAsTemplate = async (message: ChatMessage) => {
    if (!currentSession) return

    const templateName = prompt('请输入模板名称:', currentSession.name)
    if (!templateName) return

    try {
      const result = await api.session.saveAsTemplate(currentSession.id, {
        task_description: templateName,
        code: message.generated_code || '',
        file_info: workspaceFiles.map(f => ({
          name: f.name,
          size: f.size,
          type: f.name.split('.').pop() || 'unknown',
        })),
        output_files: outputFiles.map(f => ({
          name: f.name,
          size: f.size,
        })),
      })

      showToast('success', `模板「${result.template_name}」已保存成功`)
    } catch (error: any) {
      console.error('保存模板失败:', error)
      showToast('error', `保存模板失败: ${error?.message || '未知错误'}`)
    }
  }

  const handleOpenGeneratedFile = async (filename: string) => {
    if (!currentSession) return

    try {
      await api.session.openFile(currentSession.id, `output/${filename}`)
    } catch (error: any) {
      console.error('打开文件失败:', error)
      showToast('error', `打开文件失败: ${error?.message || '未知错误'}`)
    }
  }

  const handleDownloadGeneratedFile = async (filename: string) => {
    if (!currentSession) return

    try {
      await api.session.downloadFile(currentSession.id, `output/${filename}`, filename)
      showToast('success', `已下载 ${filename}`)
    } catch (error: any) {
      console.error('下载文件失败:', error)
      showToast('error', `下载文件失败: ${error?.message || '未知错误'}`)
    }
  }

  const isExecuting = messages.some(m => m.loading)

  const sendMessageToSession = async (sessionId: string, userInput: string, options: SendMessageOptions = {}) => {
    if (!userInput.trim()) return

    const userMessage: ChatMessage = {
      role: 'user',
      content: userInput,
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMessage])

    try {
      await api.session.addMessage(sessionId, userMessage)
    } catch (error) {
      console.error('保存用户消息失败:', error)
    }

    const loadingMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      loading: true,
      stageLabel: '正在理解你的目标',
      activitySteps: [],
    }
    setMessages(prev => [...prev, loadingMessage])

    try {
      await api.session.execute(sessionId, {
        user_input: userInput,
        focus_file: options.focusFile,
      })
      startSSEStream(sessionId)
    } catch (error: any) {
      console.error('启动任务失败:', error)
      setMessages(prev => {
        const filtered = prev.filter(m => !m.loading)
        return [...filtered, {
          role: 'assistant' as const,
          content: `启动任务失败: ${error.message || '未知错误'}`,
          timestamp: new Date().toISOString(),
          success: false,
        }]
      })
    }
  }

  const startSSEStream = (sessionId: string) => {
    if (sseCleanupRef.current[sessionId]) {
      sseCleanupRef.current[sessionId]()
    }

    const cleanup = subscribeToSessionStatus(
      sessionId,
      async (payload) => {
        if (payload.status === 'executing' && payload.progress) {
          const activitySteps = buildActivitySteps(payload.progress)
          setMessages(prev => {
            const lastIdx = prev.length - 1
            const lastMsg = prev[lastIdx]
            if (!lastMsg?.loading) return prev
            const merged = mergeActivitySteps(lastMsg.activitySteps || [], activitySteps)
            if (merged === lastMsg.activitySteps && lastMsg.stageLabel === payload.progress!.task_stage_label) return prev
            return [...prev.slice(0, lastIdx), { ...lastMsg, stageLabel: payload.progress!.task_stage_label, activitySteps: merged }]
          })
        } else if (payload.status === 'completed' || payload.status === 'error' || payload.status === 'stopped') {
          if (sseCleanupRef.current[sessionId]) {
            sseCleanupRef.current[sessionId]()
            delete sseCleanupRef.current[sessionId]
          }

          const fileData = await api.session.getFiles(sessionId)
          const hiddenFiles = ['task-plan.md', 'final-report.md', 'document-structure-summary.json', 'template-field-mapping.json', 'template-fill-report.json']
          const generatedFiles = (fileData.output || [])
            .filter(f => !hiddenFiles.includes(f.name))
            .map(f => ({ name: f.name, size: f.size, path: `output/${f.name}` }))
          const summaryMessage = generateCompletionSummary(payload, generatedFiles)

          const finalMessage: ChatMessage = {
            role: 'assistant',
            content: summaryMessage,
            timestamp: new Date().toISOString(),
            success: payload.status === 'completed',
            workflow_steps: payload.result?.workflow_steps,
            logs: payload.result?.logs,
            generated_code: payload.result?.generatedCode,
            generated_files: generatedFiles.length > 0 ? generatedFiles : undefined,
          }

          setMessages(prev => {
            const filtered = prev.filter(m => !m.loading)
            return [...filtered, finalMessage]
          })

          // Update cache with the final message so loadSessionData doesn't wipe it
          const cachedData = sessionDataCache.current.get(sessionId) || { workspaceFiles: [], outputFiles: [], messages: [] }
          const updatedMessages = [...cachedData.messages.filter(m => !m.loading), finalMessage]
          sessionDataCache.current.set(sessionId, { ...cachedData, messages: updatedMessages })

          await loadSessionFiles(sessionId)
          await loadSessions()

          if (payload.result?.session_name_updated && currentSession?.id === sessionId) {
            const sessions = await api.session.list()
            const updatedSession = sessions.find(s => s.id === sessionId)
            if (updatedSession) {
              setCurrentSession(updatedSession)
              setSessions(sessions)
            }
          }
        }
      },
      () => {
        delete sseCleanupRef.current[sessionId]
        console.warn('SSE connection error, task may have completed')
      }
    )

    sseCleanupRef.current[sessionId] = cleanup
  }

  const mergeActivitySteps = (existing: ActivityStep[], incoming: ActivityStep[]): ActivityStep[] => {
    const map = new Map(existing.map(s => [s.id, s]))
    let changed = false
    for (const step of incoming) {
      const prev = map.get(step.id)
      if (prev) {
        if (prev.status !== step.status || (step.detail && step.detail !== prev.detail)) {
          map.set(step.id, { ...prev, status: step.status, detail: step.detail || prev.detail })
          changed = true
        }
      } else {
        map.set(step.id, step)
        changed = true
      }
    }
    return changed ? Array.from(map.values()) : existing
  }

  const buildActivitySteps = (progress: NonNullable<ExecutionStatusResponse['progress']>): ActivityStep[] => {
    const raw: import('./types').ActivityStep[] = []
    const seen = new Set<string>()

    for (const ws of progress.workflow_steps || []) {
      const wsId = `ws-${ws.module}`
      if (seen.has(wsId)) continue
      seen.add(wsId)
      const parsed = parseWorkflowStep(ws)
      if (!parsed) continue
      raw.push({
        id: wsId, type: parsed.type, icon: parsed.icon,
        label: parsed.label, detail: parsed.detail,
        status: ws.status === 'completed' ? 'completed' : ws.status === 'error' ? 'error' : 'running',
        timestamp: new Date().toISOString(),
      })
    }

    for (const log of progress.logs || []) {
      const logId = `log-${log.timestamp}-${log.step}`
      if (seen.has(logId)) continue
      seen.add(logId)
      const parsed = parseLogEntry(log)
      if (parsed) {
        raw.push({
          id: logId, type: parsed.type, icon: parsed.icon,
          label: parsed.label, detail: parsed.detail,
          status: log.status === 'error' ? 'error' : 'completed',
          timestamp: log.timestamp,
        })
      }
    }

    return collapseConsecutiveReads(raw)
  }

  /** Merge consecutive file_read steps into one summary step */
  const collapseConsecutiveReads = (steps: ActivityStep[]): ActivityStep[] => {
    const result: import('./types').ActivityStep[] = []
    let readGroup: import('./types').ActivityStep[] = []

    const flushReads = () => {
      if (readGroup.length <= 1) {
        result.push(...readGroup)
      } else {
        const names = readGroup.map(s => {
          const m = s.label.match(/[：:](.+)$/)
          return m ? m[1].trim() : ''
        }).filter(Boolean)
        const allDone = readGroup.every(s => s.status === 'completed')
        result.push({
          id: readGroup[0].id,
          type: 'file_read',
          icon: '📖',
          label: `读取并分析了 ${readGroup.length} 个文件`,
          detail: names.length ? names.join('、') : undefined,
          status: allDone ? 'completed' : 'running',
          timestamp: readGroup[0].timestamp,
        })
      }
      readGroup = []
    }

    for (const step of steps) {
      if (step.type === 'file_read') {
        readGroup.push(step)
      } else {
        flushReads()
        result.push(step)
      }
    }
    flushReads()
    return result
  }

  const trimResult = (text: string): string => {
    const cleaned = text.replace(/^已\s*/, '')
    return cleaned.length > 120 ? cleaned.slice(0, 117) + '...' : cleaned
  }

  const parseWorkflowStep = (ws: import('./types').WorkflowStep & { module_label?: string }): { type: import('./types').ActivityStep['type']; icon: string; label: string; detail?: string } | null => {
    const output = ws.output || ''

    if (/^Decision\s+\d+/i.test(ws.module)) return null

    // Skip error steps from timeline
    if (ws.status === 'error') return null

    if (/^Agent Loop\s+\d+/i.test(ws.module)) {
      const toolMatch = output.match(/动作[：:]\s*(\S+)/)
      const resultMatch = output.match(/结果[：:]\s*(.+)$/m)
      const toolName = toolMatch?.[1] || ''
      const result = resultMatch?.[1]?.trim() || ''
      const fileMatch = output.match(/target["\s:]+([^"\n,}]+)/i)
      const fileName = fileMatch?.[1]?.trim() || ''
      const detail = result ? trimResult(result) : undefined

      if (toolName === 'end_turn') return null

      if (['read_file', 'read_multiple_files'].includes(toolName))
        return { type: 'file_read', icon: '📖', label: `读取文件：${fileName || '...'}`, detail }
      if (['inspect_file', 'inspect_word_structure', 'inspect_word_tables', 'preview_spreadsheet'].includes(toolName))
        return { type: 'file_read', icon: '🔎', label: `分析文件：${fileName || '...'}`, detail }
      if (['observe_workspace', 'list_workspace_tree'].includes(toolName))
        return { type: 'file_read', icon: '📂', label: '扫描工作区文件', detail }
      if (['write_file', 'write_markdown_report', 'write_json_result', 'write_word_patches'].includes(toolName))
        return { type: 'file_write', icon: '✍️', label: `写入文件：${fileName || '...'}`, detail }
      if (toolName === 'execute_python')
        return { type: 'tool', icon: '🐍', label: 'Python 脚本处理', detail }
      if (toolName === 'summarize_forwarding_spreadsheet')
        return { type: 'file_write', icon: '📊', label: '生成 Excel 汇总', detail }
      if (toolName === 'convert_doc_to_docx')
        return { type: 'file_write', icon: '🔄', label: '转换 Word 格式', detail }
      if (toolName === 'copy_workspace_file_to_output')
        return { type: 'file_write', icon: '📋', label: '复制文件到输出区', detail }
      if (toolName === 'generate_document_vote_summary')
        return { type: 'file_write', icon: '📊', label: '统计投票结果', detail }
      if (['inspect_word_template_slots', 'extract_word_field_values'].includes(toolName))
        return { type: 'file_read', icon: '🔍', label: `分析文档字段：${fileName || '...'}`, detail }
      if (toolName === 'match_word_fields_to_template')
        return { type: 'tool', icon: '🔗', label: '匹配字段到模板', detail }
      if (['list_mcp_tools', 'call_mcp_tool'].includes(toolName))
        return { type: 'tool', icon: '⚙️', label: toolName === 'list_mcp_tools' ? '查看工具列表' : '执行工具', detail }
      
      return null
    }
    return null
  }

  const parseLogEntry = (log: import('./types').ExecutionLog & { step_label?: string }): { type: import('./types').ActivityStep['type']; icon: string; label: string; detail?: string } | null => {
    const content = log.content || ''
    if (content.includes('已匹配技能')) return { type: 'skill_match', icon: '🎯', label: content }
    if (content.includes('触发用户澄清') || content.includes('等待补充信息')) return { type: 'clarification', icon: '❓', label: content }
    if (log.step === 'agent-loop' && content.includes('停止请求')) return { type: 'stage', icon: '🛑', label: '收到停止请求' }
    return null
  }

  const generateCompletionSummary = (status: import('./types').ExecutionStatusResponse, generatedFiles: Array<{name: string; size: number; path: string}>): string => {
    if (status.status === 'error') {
      return `❌ 任务执行失败\n\n${status.error || '未知错误，请查看执行日志了解详情。'}`
    }

    if (status.status === 'stopped') {
      const hasOutput = generatedFiles.length > 0
      return hasOutput
        ? `⏸️ 任务已停止\n\n已生成 ${generatedFiles.length} 个文件，你可以查看已完成的部分结果。`
        : `⏸️ 任务已停止\n\n尚未生成任何输出文件。`
    }

    const aiMessage = status.result?.message?.trim()
    const fileCount = generatedFiles.length

    if (fileCount === 0) {
      return aiMessage || '✅ 任务已完成'
    }

    const parts: string[] = []

    if (aiMessage) {
      parts.push(aiMessage)
    } else {
      parts.push('✅ 任务已完成')
    }

    const wordFiles = generatedFiles.filter(f => /\.docx?$/i.test(f.name))
    const excelFiles = generatedFiles.filter(f => /\.xlsx?$/i.test(f.name))
    const otherFiles = generatedFiles.filter(f => !/\.(docx?|xlsx?)$/i.test(f.name))

    parts.push('')

    if (wordFiles.length > 0) {
      parts.push(`📝 Word 文档（${wordFiles.length} 个）：${wordFiles.map(f => f.name).join('、')}`)
    }
    if (excelFiles.length > 0) {
      parts.push(`📊 Excel 文件（${excelFiles.length} 个）：${excelFiles.map(f => f.name).join('、')}`)
    }
    if (otherFiles.length > 0) {
      parts.push(`📄 其他文件（${otherFiles.length} 个）：${otherFiles.map(f => f.name).join('、')}`)
    }

    parts.push('点击下方文件卡片可打开或下载。')

    return parts.join('\n')
  }

  // ── 观测台数据派生：现有 SSE → buildActivitySteps 流的新展示层（无任何演示数据） ──
  const loadingMessage = messages.find(m => m.loading)
  const lastFinalMessage = useMemo(
    () =>
      [...messages]
        .reverse()
        .find(m => m.role === 'assistant' && !m.loading && ((m.workflow_steps?.length || 0) > 0 || (m.logs?.length || 0) > 0)),
    [messages]
  )

  const obsSteps: ActivityStep[] = useMemo(() => {
    if (loadingMessage) return loadingMessage.activitySteps || []
    if (lastFinalMessage) {
      // 回放：用同一套 buildActivitySteps 从最终消息的真实 workflow/logs 推导终态
      return buildActivitySteps({
        workflow_steps: (lastFinalMessage.workflow_steps || []) as NonNullable<ExecutionStatusResponse['progress']>['workflow_steps'],
        logs: (lastFinalMessage.logs || []) as NonNullable<ExecutionStatusResponse['progress']>['logs'],
        message: '',
      })
    }
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMessage, loadingMessage?.activitySteps, lastFinalMessage])

  const obsCompleted = !isExecuting && !!lastFinalMessage?.success
  const obsStarted = isExecuting || obsSteps.length > 0
  const deliveredCount = lastFinalMessage?.generated_files?.length || 0
  const executionKey = loadingMessage?.timestamp || lastFinalMessage?.timestamp || currentSession?.id || 'none'
  const obsModel = useMemo(
    () => deriveObservatory({ steps: obsSteps, executing: isExecuting, completed: obsCompleted, started: obsStarted }),
    [obsSteps, isExecuting, obsCompleted, obsStarted]
  )

  return (
    <div className="app">
      <TitleBar currentSession={currentSession} />
      <div className="app-content">
        <WorkspaceSidebar
          sessions={sessions}
          currentSession={currentSession}
          isExecuting={isExecuting}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onCreateSession={handleCreateSession}
          onOpenFinder={() => setFinderOpen(true)}
          onOpenTemplates={() => setShowTemplateLibrary(prev => (templateMode === 'modal' ? !prev : true))}
          templatesOpen={showTemplateLibrary}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />
        <WorkspacePanel
          workspaceFiles={workspaceFiles}
          outputFiles={outputFiles}
          isOpen={filesOpen}
          onToggle={() => setFilesOpen(prev => !prev)}
          onUploadFile={handleUploadFile}
          onDeleteFile={handleDeleteFile}
          currentSession={currentSession}
          focusedFile={focusedFile}
          onFocusFile={setFocusedFile}
        />
        <main className="app-main">
          <WorkHeader
            currentSession={currentSession}
            mode={mode}
            onSetMode={handleSetMode}
            isExecuting={isExecuting}
            onStop={handleStopExecution}
          />
          {mode === 'obs' ? (
            <Observatory
              steps={obsSteps}
              isExecuting={isExecuting}
              completed={obsCompleted}
              started={obsStarted}
              deliveredCount={deliveredCount}
              executionKey={executionKey}
              currentSession={currentSession}
              onSendMessage={handleSendMessage}
              focusedFile={focusedFile}
            />
          ) : (
            <ChatView
              messages={messages}
              currentSession={currentSession}
              onSendMessage={handleSendMessage}
              isExecuting={isExecuting}
              onSaveAsTemplate={handleSaveAsTemplate}
              focusedFile={focusedFile}
              onClearFocus={() => setFocusedFile('')}
              onRevertToMessage={handleRevertToMessage}
              onOpenGeneratedFile={handleOpenGeneratedFile}
              onDownloadGeneratedFile={handleDownloadGeneratedFile}
              onGoObservatory={() => handleSetMode('obs')}
              progressPct={obsModel.pct}
            />
          )}
        </main>
        {finderOpen && (
          <ConvoFinder
            sessions={sessions}
            currentSession={currentSession}
            onClose={() => setFinderOpen(false)}
            onOpenSession={handleSelectSession}
            onCreateSession={handleCreateSession}
          />
        )}
        {templateMode === 'sidebar' && showTemplateLibrary && (
          <TemplateLibrary
            mode="sidebar"
            onClose={() => {}}
            onUseTemplate={() => {}}
            onToggleMode={() => {}}
            currentSession={currentSession}
          />
        )}
        {templateMode === 'modal' && showTemplateLibrary && (
          <TemplateLibrary
            mode="modal"
            onClose={() => setShowTemplateLibrary(false)}
            onUseTemplate={() => {}}
            onToggleMode={() => {}}
            currentSession={currentSession}
          />
        )}
      </div>
      <ToastContainer />
    </div>
  )
}

export default App
