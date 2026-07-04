import React, { useState, useRef, useEffect } from 'react'
import { Send, ChevronDown, ChevronUp, StopCircle, CheckCircle2, XCircle } from 'lucide-react'
import './ChatArea.css'

function ChatArea({ messages, currentSession, onSendMessage, isExecuting, onSaveAsTemplate, onStopExecution, focusedFile, onRevertToMessage, onOpenGeneratedFile, onDownloadGeneratedFile }) {
  const [input, setInput] = useState('')
  const [expandedSteps, setExpandedSteps] = useState({})
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      const scrollHeight = textarea.scrollHeight
      const newHeight = input.trim()
        ? Math.min(Math.max(scrollHeight, 40), 200)
        : 40
      textarea.style.height = `${newHeight}px`
    }
  }, [input])

  const handleSend = () => {
    if (input.trim() && !isExecuting) {
      onSendMessage(input, { focusFile: focusedFile || undefined })
      setInput('')
      if (textareaRef.current) textareaRef.current.style.height = '22px'
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const lineCount = input.split('\n').length

  const handleStop = async () => {
    if (!currentSession || !isExecuting) return
    if (!confirm('确定要停止当前任务吗？已完成的步骤将被保留。')) return
    if (onStopExecution) await onStopExecution(currentSession.id)
  }

  const toggleStep = (messageIndex, stepIndex) => {
    const key = `${messageIndex}-${stepIndex}`
    setExpandedSteps(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const renderActivityTimeline = (message) => {
    const steps = message.activitySteps || []
    const stageLabel = message.stageLabel || '正在处理'

    return (
      <div className="activity-timeline">
        <div className="timeline-status-bar">
          <div className="timeline-status-dots">
            <span className="status-dot" />
            <span className="status-dot" />
            <span className="status-dot" />
          </div>
          <span className="timeline-stage-label">{stageLabel}</span>
        </div>

        {steps.length > 0 && (
          <div className="timeline-steps">
            {steps.map((step, idx) => {
              const isLast = idx === steps.length - 1
              const isRunning = step.status === 'running'
              return (
                <div key={step.id} className={`tl-row ${step.status} ${isLast && isRunning ? 'tl-row--active' : ''}`}>
                  <div className="tl-gutter">
                    <div className="tl-node">
                      {step.status === 'completed' && <CheckCircle2 size={13} />}
                      {step.status === 'error' && <XCircle size={13} />}
                      {step.status === 'running' && <span className="tl-node-pulse" />}
                    </div>
                    {!isLast && <div className="tl-rail" />}
                  </div>
                  <div className="tl-body">
                    <span className="tl-icon">{step.icon}</span>
                    <span className="tl-label">{step.label}</span>
                    {step.detail && <span className="tl-detail">{step.detail}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="chat-area">
      <div className="chat-header">
        <h2>{currentSession ? currentSession.name : 'AI自动化办公助手'}</h2>
        <div className="chat-header-meta">
          {focusedFile && <div className="focus-indicator">聚焦：{focusedFile}</div>}
          {currentSession && <div className="session-indicator">当前会话</div>}
        </div>
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
              {message.role === 'user' && message.timestamp && !isExecuting && (
                <button
                  className="revert-btn"
                  onClick={() => onRevertToMessage && onRevertToMessage(message.timestamp)}
                  title="回退到此消息之前的状态"
                >
                  ↩
                </button>
              )}
              <div className="message-content">
                {message.loading ? (
                  renderActivityTimeline(message)
                ) : (
                  <>
                    <div className="message-text">{message.content}</div>

                    {message.success && message.generated_code && (
                      <button className="save-template-btn" onClick={() => onSaveAsTemplate && onSaveAsTemplate(message)} title="保存为模板以便复用">
                        ⭐ 保存为模板
                      </button>
                    )}

                    {message.generated_files && message.generated_files.length > 0 && (
                      <div className="generated-files-card">
                        <div className="generated-files-title">已生成 {message.generated_files.length} 个文件</div>
                        {message.generated_files.some(f => /\.docx?$/i.test(f.name)) && (
                          <div className="generated-files-hint">已生成可交付 Word 文件，建议优先打开或下载带有 "Word 输出" 标识的文件。</div>
                        )}
                        <div className="generated-files-list">
                          {[...message.generated_files].sort((a, b) => {
                            const aW = /\.docx?$/i.test(a.name), bW = /\.docx?$/i.test(b.name)
                            if (aW !== bW) return aW ? -1 : 1
                            return a.name.localeCompare(b.name, 'zh-CN')
                          }).map((file, fi) => {
                            const isWord = /\.docx?$/i.test(file.name)
                            return (
                              <div key={fi} className={`generated-file-item ${isWord ? 'word-output' : ''}`}>
                                <div className="generated-file-meta">
                                  <span className="generated-file-name">{file.name}</span>
                                  {isWord && <span className="generated-file-badge">Word 输出</span>}
                                </div>
                                <div className="generated-file-actions">
                                  <button onClick={() => onOpenGeneratedFile && onOpenGeneratedFile(file.name)}>打开</button>
                                  <button onClick={() => onDownloadGeneratedFile && onDownloadGeneratedFile(file.name)}>下载</button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {message.workflow_steps && message.workflow_steps.length > 0 && (
                      <details className="execution-details">
                        <summary>执行详情 ({message.workflow_steps.length} 步)</summary>
                        <div className="execution-details-content">
                          {message.workflow_steps.map((step, si) => (
                            <div key={si} className="detail-step">
                              <div className="detail-step-header" onClick={() => toggleStep(index, si)}>
                                <div className="detail-step-title">
                                  <span className={`step-status ${step.status}`}>{step.status === 'completed' ? '✓' : step.status === 'error' ? '✗' : '○'}</span>
                                  <span>{step.module}</span>
                                </div>
                                {expandedSteps[`${index}-${si}`] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </div>
                              {expandedSteps[`${index}-${si}`] && (
                                <div className="detail-step-content">
                                  <pre>{step.output}</pre>
                                  {step.code && (<div className="code-block"><div className="code-header">生成的代码</div><pre><code>{step.code}</code></pre></div>)}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {message.logs && message.logs.length > 0 && (
                      <details className="execution-logs">
                        <summary>执行日志 ({message.logs.length} 条)</summary>
                        <div className="logs-content">
                          {message.logs.map((log, li) => (
                            <div key={li} className={`log-entry ${log.status}`}>
                              <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
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
        {focusedFile && (
          <div className="focus-banner">
            <span>当前焦点文件：{focusedFile}</span>
            <button className="focus-clear" onClick={() => {}}>×</button>
          </div>
        )}
        <div className="input-container">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={currentSession ? "描述您的需求或提出改进建议... (Shift+Enter 换行)" : "创建新会话或描述您的办公需求... (Shift+Enter 换行)"}
            rows={1}
            disabled={isExecuting}
          />
          {input.length > 100 && (
            <div className="char-counter">{input.length} {lineCount > 1 && `· ${lineCount}行`}</div>
          )}
          {isExecuting ? (
            <button className="stop-btn" onClick={handleStop} title="停止当前任务"><StopCircle size={18} /></button>
          ) : (
            <button className="send-btn" onClick={handleSend} disabled={!input.trim()} title={input.trim() ? "发送消息 (Enter)" : "请输入内容"}><Send size={18} /></button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ChatArea
