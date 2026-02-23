import React, { useState, useEffect } from 'react'
import TitleBar from './components/TitleBar'
import SessionSidebar from './components/SessionSidebar'
import WorkspacePanel from './components/WorkspacePanel'
import ChatArea from './components/ChatArea'
import TemplateLibrary from './components/TemplateLibrary'
import { api } from './utils/api'
import './App.css'

function App() {
  const [sessions, setSessions] = useState([])
  const [currentSession, setCurrentSession] = useState(null)
  const [workspaceFiles, setWorkspaceFiles] = useState([])
  const [outputFiles, setOutputFiles] = useState([])
  const [messages, setMessages] = useState([])
  const [isSessionSidebarOpen, setIsSessionSidebarOpen] = useState(true)
  const [sessionExecutionStatus, setSessionExecutionStatus] = useState({})
  
  // 模板库状态
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false)
  const [templateMode, setTemplateMode] = useState('modal') // 'modal' | 'sidebar'
  
  const pollingTimers = React.useRef({})

  // 加载会话列表
  useEffect(() => {
    loadSessions()
  }, [])

  // 加载当前会话的文件和消息
  useEffect(() => {
    if (currentSession) {
      loadSessionFiles(currentSession.id)
      loadSessionMessages(currentSession.id)
    }
  }, [currentSession])
  
  // 清理轮询定时器
  useEffect(() => {
    return () => {
      Object.values(pollingTimers.current).forEach(timer => clearInterval(timer))
    }
  }, [])
  
  // 加载用户偏好设置
  useEffect(() => {
    const savedMode = localStorage.getItem('templateMode')
    if (savedMode === 'sidebar') {
      setTemplateMode('sidebar')
      setShowTemplateLibrary(true)
    }
  }, [])
  
  // 快捷键支持 (Ctrl/Cmd + T)
  useEffect(() => {
    const handleKeyPress = (e) => {
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

  const loadSessions = async () => {
    try {
      const data = await api.getSessions()
      setSessions(data.sessions)
    } catch (error) {
      console.error('加载会话失败:', error)
    }
  }

  const loadSessionFiles = async (sessionId) => {
    try {
      const data = await api.getSessionFiles(sessionId)
      setWorkspaceFiles(data.workspace || [])
      setOutputFiles(data.output || [])
    } catch (error) {
      console.error('加载文件失败:', error)
    }
  }

  const loadSessionMessages = async (sessionId) => {
    try {
      const data = await api.getMessages(sessionId)
      setMessages(data.messages || [])
    } catch (error) {
      console.error('加载消息失败:', error)
    }
  }

  const handleCreateSession = async () => {
    try {
      const data = await api.createSession('')
      
      const newSession = {
        id: data.session_id,
        name: data.session_name,
        created_at: new Date().toISOString(),
        workspace_path: data.workspace_path,
        output_path: data.output_path
      }
      
      setSessions(prev => [...prev, newSession])
      setCurrentSession(newSession)
      setMessages([])
      setWorkspaceFiles([])
      setOutputFiles([])
    } catch (error) {
      console.error('创建会话失败:', error)
      alert('创建会话失败: ' + error.message)
    }
  }

  const handleDeleteSession = async (sessionId) => {
    try {
      await api.deleteSession(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      
      if (currentSession?.id === sessionId) {
        setCurrentSession(null)
        setWorkspaceFiles([])
        setOutputFiles([])
        setMessages([])
      }
    } catch (error) {
      console.error('删除会话失败:', error)
    }
  }

  const handleSelectSession = (session) => {
    setCurrentSession(session)
  }

  const handleUploadFile = async (file) => {
    if (!currentSession) return
    
    try {
      await api.uploadFile(currentSession.id, file)
      await loadSessionFiles(currentSession.id)
    } catch (error) {
      console.error('上传文件失败:', error)
      alert('上传文件失败: ' + error.message)
    }
  }

  const handleDeleteFile = async (filepath, isOutput = false) => {
    if (!currentSession) return
    
    try {
      await api.deleteFile(currentSession.id, filepath)
      await loadSessionFiles(currentSession.id)
    } catch (error) {
      console.error('删除文件失败:', error)
    }
  }

  const handleSendMessage = async (userInput) => {
    setIsSessionSidebarOpen(false)
    
    if (!currentSession) {
      try {
        const data = await api.createSession('')
        const newSession = {
          id: data.session_id,
          name: data.session_name,
          created_at: new Date().toISOString(),
          workspace_path: data.workspace_path,
          output_path: data.output_path
        }
        
        setSessions(prev => [...prev, newSession])
        setCurrentSession(newSession)
        setMessages([])
        setWorkspaceFiles([])
        setOutputFiles([])
        
        await sendMessageToSession(newSession.id, userInput)
      } catch (error) {
        console.error('创建会话失败:', error)
      }
      return
    }

    await sendMessageToSession(currentSession.id, userInput)
  }

  const sendMessageToSession = async (sessionId, userInput) => {
    // 直接执行正常工作流，不再检查相似模板
    executeNormalWorkflow(sessionId, userInput)
  }
  
  const executeNormalWorkflow = async (sessionId, userInput) => {
    const userMessage = {
      role: 'user',
      content: userInput,
      timestamp: new Date().toISOString()
    }
    
    setMessages(prev => [...prev, userMessage])
    await api.addMessage(sessionId, userMessage)

    const loadingMessage = {
      role: 'assistant',
      content: '正在处理中...',
      loading: true,
      timestamp: new Date().toISOString()
    }
    setMessages(prev => [...prev, loadingMessage])

    setSessionExecutionStatus(prev => ({ ...prev, [sessionId]: true }))

    try {
      const submitResult = await api.executeWorkflow(sessionId, userInput)
      
      if (!submitResult.success) {
        throw new Error(submitResult.error || '提交任务失败')
      }
      
      startPollingStatus(sessionId)
      
    } catch (error) {
      console.error('提交工作流失败:', error)
      
      setSessionExecutionStatus(prev => ({ ...prev, [sessionId]: false }))
      
      const errorMessage = {
        role: 'assistant',
        content: '提交失败: ' + error.message,
        error: true,
        timestamp: new Date().toISOString()
      }
      
      setMessages(prev => {
        const newMessages = [...prev]
        newMessages[newMessages.length - 1] = errorMessage
        return newMessages
      })
    }
  }
  
  const startPollingStatus = (sessionId) => {
    // 清除之前的定时器（如果有）
    if (pollingTimers.current[sessionId]) {
      clearInterval(pollingTimers.current[sessionId])
    }
    
    // 每秒轮询一次状态
    pollingTimers.current[sessionId] = setInterval(async () => {
      try {
        const statusResult = await api.getExecutionStatus(sessionId)
        
        console.log(`🔄 会话 ${sessionId} 状态:`, statusResult.status)
        
        if (statusResult.status === 'completed') {
          // 执行完成
          clearInterval(pollingTimers.current[sessionId])
          delete pollingTimers.current[sessionId]
          
          // 标记该会话执行完成
          setSessionExecutionStatus(prev => ({
            ...prev,
            [sessionId]: false
          }))
          
          const result = statusResult.result
          
          // 更新助手消息
          const assistantMessage = {
            role: 'assistant',
            content: result.message,
            workflow_steps: result.workflow_steps,
            logs: result.logs,
            success: result.success,
            timestamp: new Date().toISOString(),
            // 保存代码信息，用于"保存为模板"功能
            generated_code: result.generated_code,
            task_description: result.task_description
          }
      
          setMessages(prev => {
            const newMessages = [...prev]
            newMessages[newMessages.length - 1] = assistantMessage
            return newMessages
          })
      
          await api.addMessage(sessionId, assistantMessage)
      
          // 如果会话名称被更新，更新会话列表
          if (result.session_name_updated && result.session_name) {
            console.log('🔄 更新会话名称:', result.session_name)
            setSessions(prev => prev.map(s => 
              s.id === sessionId ? { ...s, name: result.session_name } : s
            ))
            
            if (currentSession?.id === sessionId) {
              setCurrentSession(prev => ({
                ...prev,
                name: result.session_name
              }))
            }
          }
      
          // 刷新文件列表 - 确保无论是否是当前会话都刷新
          if (currentSession?.id === sessionId) {
            await loadSessionFiles(sessionId)
          }
      
        } else if (statusResult.status === 'error') {
          // 执行出错
          clearInterval(pollingTimers.current[sessionId])
          delete pollingTimers.current[sessionId]
          
          // 标记该会话执行完成
          setSessionExecutionStatus(prev => ({
            ...prev,
            [sessionId]: false
          }))
      
          // 更新为错误消息
          const errorMessage = {
            role: 'assistant',
            content: '执行失败: ' + statusResult.error,
            error: true,
            timestamp: new Date().toISOString()
          }
      
          setMessages(prev => {
            const newMessages = [...prev]
            newMessages[newMessages.length - 1] = errorMessage
            return newMessages
          })
        }
        // 如果是 'executing' 状态，继续轮询
        
      } catch (error) {
        console.error('轮询状态失败:', error)
        // 继续轮询，不中断
      }
    }, 1000) // 每秒轮询一次
  }
  
  const handleExecuteTemplate = async (templateId) => {
    if (!currentSession) {
      alert('请先创建或选择一个会话')
      return
    }

    const sessionId = currentSession.id

    // 添加执行中的消息
    const executingMessage = {
      role: 'assistant',
      content: '正在使用模板执行...',
      loading: true,
      timestamp: new Date().toISOString()
    }
    setMessages(prev => [...prev, executingMessage])

    try {
      const result = await api.executeTemplate(templateId, sessionId, '')

      // 更新为成功消息
      const successMessage = {
        role: 'assistant',
        content: result.message + (result.compatibility_warning ? `\n\n⚠️ ${result.compatibility_warning}` : ''),
        success: true,
        timestamp: new Date().toISOString(),
        template_executed: true
      }

      setMessages(prev => {
        const newMessages = [...prev]
        newMessages[newMessages.length - 1] = successMessage
        return newMessages
      })

      await api.addMessage(sessionId, successMessage)

      // 如果会话名称被更新，更新会话列表
      if (result.session_name_updated && result.session_name) {
        console.log('🔄 模板执行后更新会话名称:', result.session_name)
        setSessions(prev => prev.map(s =>
          s.id === sessionId ? { ...s, name: result.session_name } : s
        ))

        if (currentSession?.id === sessionId) {
          setCurrentSession(prev => ({
            ...prev,
            name: result.session_name
          }))
        }
      }

      // 刷新文件列表
      if (currentSession?.id === sessionId) {
        await loadSessionFiles(sessionId)
      }

    } catch (error) {
      console.error('模板执行失败:', error)

      // 更新为错误消息
      const errorMessage = {
        role: 'assistant',
        content: '模板执行失败: ' + error.message,
        error: true,
        timestamp: new Date().toISOString()
      }

      setMessages(prev => {
        const newMessages = [...prev]
        newMessages[newMessages.length - 1] = errorMessage
        return newMessages
      })
    }
  }
  
  const handleSaveAsTemplate = async (message) => {
    try {
      if (!currentSession) return
      
      // 获取文件信息
      const files = await api.getSessionFiles(currentSession.id)
      
      // 使用当前会话名称作为模板名称
      const result = await api.saveAsTemplate(
        currentSession.id,
        currentSession.name,  // 使用会话名称
        message.generated_code,
        files.workspace || [],
        files.output || []
      )
      
      if (result.success) {
        alert('✅ 模板保存成功！\n\n模板名称：' + currentSession.name)
      }
    } catch (error) {
      console.error('保存模板失败:', error)
      alert('保存模板失败: ' + error.message)
    }
  }
  
  const handleToggleTemplateMode = () => {
    if (templateMode === 'modal') {
      // 切换到侧边栏模式
      setTemplateMode('sidebar')
      setShowTemplateLibrary(true)
      localStorage.setItem('templateMode', 'sidebar')
    } else {
      // 切换到弹窗模式
      setTemplateMode('modal')
      setShowTemplateLibrary(false)
      localStorage.setItem('templateMode', 'modal')
    }
  }
  
  const handleUseTemplate = async (templateId) => {
    await handleExecuteTemplate(templateId)
  }
  
  const handleStopExecution = async (sessionId) => {
    try {
      console.log('🛑 请求停止执行 - 会话ID:', sessionId)
      
      const result = await api.stopExecution(sessionId)
      
      if (result.success) {
        console.log('✅ 停止请求已发送')
        
        // 更新执行状态
        setSessionExecutionStatus(prev => ({
          ...prev,
          [sessionId]: false
        }))
        
        // 添加停止消息
        const stopMessage = {
          role: 'assistant',
          content: '⚠️ 任务已被用户停止',
          timestamp: new Date().toISOString(),
          interrupted: true
        }
        
        setMessages(prev => {
          const newMessages = [...prev]
          // 替换最后一条 loading 消息
          if (newMessages.length > 0 && newMessages[newMessages.length - 1].loading) {
            newMessages[newMessages.length - 1] = stopMessage
          } else {
            newMessages.push(stopMessage)
          }
          return newMessages
        })
        
        await api.addMessage(sessionId, stopMessage)
        
        alert('✅ 停止请求已发送，任务将在当前步骤完成后停止')
      } else {
        alert(result.message || '停止失败')
      }
    } catch (error) {
      console.error('❌ 停止执行失败:', error)
      alert('停止失败: ' + (error.response?.data?.error || error.message))
    }
  }

  return (
    <div className="app">
      <TitleBar 
        currentSession={currentSession}
        onOpenTemplates={() => setShowTemplateLibrary(true)}
        templateMode={templateMode}
      />
      
      <div className="app-content">
        <SessionSidebar
          sessions={sessions}
          currentSession={currentSession}
          isOpen={isSessionSidebarOpen}
          onToggle={() => setIsSessionSidebarOpen(!isSessionSidebarOpen)}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onCreateSession={handleCreateSession}
        />
        
        <WorkspacePanel
          workspaceFiles={workspaceFiles}
          outputFiles={outputFiles}
          isOpen={true}
          onToggle={() => {}}
          onUploadFile={handleUploadFile}
          onDeleteFile={handleDeleteFile}
          currentSession={currentSession}
        />
        
        <ChatArea
          messages={messages}
          currentSession={currentSession}
          onSendMessage={handleSendMessage}
          isExecuting={currentSession ? sessionExecutionStatus[currentSession.id] || false : false}
          onSaveAsTemplate={handleSaveAsTemplate}
          onStopExecution={handleStopExecution}
          onExecuteTemplate={handleExecuteTemplate}
        />
        
        {/* 模板库 - 侧边栏模式 */}
        {templateMode === 'sidebar' && showTemplateLibrary && (
          <TemplateLibrary
            mode="sidebar"
            onUseTemplate={handleUseTemplate}
            onToggleMode={handleToggleTemplateMode}
            currentSession={currentSession}
          />
        )}
        
        {/* 模板库 - 弹窗模式 */}
        {templateMode === 'modal' && showTemplateLibrary && (
          <TemplateLibrary
            mode="modal"
            onClose={() => setShowTemplateLibrary(false)}
            onUseTemplate={handleUseTemplate}
            onToggleMode={handleToggleTemplateMode}
            currentSession={currentSession}
          />
        )}
      </div>
    </div>
  )
}

export default App
