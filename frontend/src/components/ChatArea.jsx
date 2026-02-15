import React, { useState, useRef, useEffect } from 'react'
import { Send, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import './ChatArea.css'

function ChatArea({ messages, currentSession, onSendMessage, isExecuting, onSaveAsTemplate }) {
  const [input, setInput] = useState('')
  const [expandedSteps, setExpandedSteps] = useState({})
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (input.trim() && !isExecuting) {
      onSendMessage(input)
      setInput('')
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={currentSession ? "描述您的需求或提出改进建议..." : "创建新会话或描述您的办公需求..."}
            rows={1}
            disabled={isExecuting}
          />
          <button 
            className="send-btn" 
            onClick={handleSend}
            disabled={!input.trim() || isExecuting}
            title={isExecuting ? "当前会话正在执行中..." : "发送消息"}
          >
            {isExecuting ? <Loader2 className="spinner" size={18} /> : <Send size={18} />}
          </button>
        </div>
        {isExecuting && (
          <div className="execution-hint">
            ⚡ 当前会话正在执行中，您可以切换到其他会话继续工作
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatArea

