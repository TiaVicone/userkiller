import React, { useState, useRef, useEffect } from 'react'
import { Send, ChevronDown, ChevronUp, Loader2, StopCircle } from 'lucide-react'
import './ChatArea.css'

function ChatArea({ messages, currentSession, onSendMessage, isExecuting, onSaveAsTemplate, onStopExecution }) {
  const [input, setInput] = useState('')
  const [expandedSteps, setExpandedSteps] = useState({})
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 自动调整输入框高度
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      // 重置高度以获取正确的 scrollHeight
      textarea.style.height = 'auto'
      // 设置新高度，最小 22px，最大 200px
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 22), 200)
      textarea.style.height = `${newHeight}px`
    }
  }, [input])

  const handleSend = () => {
    if (input.trim() && !isExecuting) {
      onSendMessage(input)
      setInput('')
      // 重置输入框高度
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputChange = (e) => {
    setInput(e.target.value)
  }

  // 计算输入行数（用于显示提示）
  const lineCount = input.split('\n').length

  const handleStop = async () => {
    if (!currentSession || !isExecuting) return
    
    if (!confirm('确定要停止当前任务吗？已完成的步骤将被保留。')) return
    
    if (onStopExecution) {
      await onStopExecution(currentSession.id)
    }
  }

  const toggleStep = (messageIndex, stepIndex) => {
    const key = `${messageIndex}-${stepIndex}`
    setExpandedSteps(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  return (
    <div className="chat-area">
      <div className="chat-header">
        <h2>{currentSession ? currentSession.name : 'AI自动化办公助手'}</h2>
        {currentSession && <div className="session-indicator">当前会话</div>}
      </div>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="welcome-screen">
            <div className="welcome-icon">🤖</div>
            <h1>AI自动化办公助手</h1>
            <p>告诉我您的办公需求，我将为您自动处理</p>
            <div className="example-prompts">
              <div className="example-prompt">批量填写员工信息表</div>
              <div className="example-prompt">生成月度工作报告</div>
              <div className="example-prompt">合并多个Excel文件</div>
              <div className="example-prompt">批量生成通知文档</div>
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              <div className="message-content">
                {message.loading ? (
                  <div className="loading-message">
                    <Loader2 className="spinner" size={20} />
                    <span>正在处理中...</span>
                  </div>
                ) : (
                  <>
                    <div className="message-text">{message.content}</div>
                    
                    {/* 成功消息显示"保存为模板"按钮 */}
                    {message.success && message.generated_code && (
                      <button 
                        className="save-template-btn"
                        onClick={() => onSaveAsTemplate && onSaveAsTemplate(message)}
                        title="保存为模板以便复用"
                      >
                        ⭐ 保存为模板
                      </button>
                    )}
                    
                    {message.workflow_steps && message.workflow_steps.length > 0 && (
                      <div className="workflow-steps">
                        <div className="steps-header">工作流程</div>
                        {message.workflow_steps.map((step, stepIndex) => (
                          <div key={stepIndex} className="workflow-step">
                            <div 
                              className="step-header"
                              onClick={() => toggleStep(index, stepIndex)}
                            >
                              <div className="step-title">
                                <span className={`step-status ${step.status}`}>
                                  {step.status === 'completed' ? '✓' : 
                                   step.status === 'error' ? '✗' : '○'}
                                </span>
                                <span>{step.module}</span>
                              </div>
                              {expandedSteps[`${index}-${stepIndex}`] ? 
                                <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                            
                            {expandedSteps[`${index}-${stepIndex}`] && (
                              <div className="step-content">
                                <pre>{step.output}</pre>
                                {step.code && (
                                  <div className="code-block">
                                    <div className="code-header">生成的代码</div>
                                    <pre><code>{step.code}</code></pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {message.logs && message.logs.length > 0 && (
                      <details className="execution-logs">
                        <summary>执行日志 ({message.logs.length}条)</summary>
                        <div className="logs-content">
                          {message.logs.map((log, logIndex) => (
                            <div key={logIndex} className={`log-entry ${log.status}`}>
                              <span className="log-time">
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </span>
                              <span className="log-step">[{log.step}]</span>
                              <span className="log-content">{log.content}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <div className="input-container">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder={currentSession ? "描述您的需求或提出改进建议... (Shift+Enter 换行)" : "创建新会话或描述您的办公需求... (Shift+Enter 换行)"}
            rows={1}
            disabled={isExecuting}
          />
          
          {/* 字符计数器（仅在输入较多时显示） */}
          {input.length > 100 && (
            <div className="char-counter">
              {input.length} {lineCount > 1 && `· ${lineCount}行`}
            </div>
          )}
          
          {/* 执行中显示停止按钮，否则显示发送按钮 */}
          {isExecuting ? (
            <button 
              className="stop-btn" 
              onClick={handleStop}
              title="停止当前任务"
            >
              <StopCircle size={18} />
            </button>
          ) : (
            <button 
              className="send-btn" 
              onClick={handleSend}
              disabled={!input.trim()}
              title={input.trim() ? "发送消息 (Enter)" : "请输入内容"}
            >
              <Send size={18} />
            </button>
          )}
        </div>
        {isExecuting && (
          <div className="execution-hint">
            ⚡ 任务执行中... 
            <span className="hint-action">点击停止按钮可中断执行</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatArea

