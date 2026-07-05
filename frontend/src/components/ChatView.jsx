import React, { useState, useRef, useEffect, useMemo, useSyncExternalStore } from 'react'
import { ArrowUp, Undo2, Star, Sparkles, Orbit, Diamond, X } from 'lucide-react'
import {
  subscribe,
  getVersion,
  getWorkspaces,
  workspaceOf,
  getClassification,
  isFreshClassification,
  acknowledgeClassification,
  moveSessionToWorkspace,
  extractToNewWorkspace,
  extractWorkspaceMemory,
} from '../utils/workspaceStore'
import { extOf, extClass, formatFileSize } from '../utils/ui'
import './ChatView.css'

const STARTERS = ['批量填写员工信息表', '生成月度工作报告', '合并多个Excel文件', '批量生成通知文档']

/** 对话视图：与观测台一键互切；执行流逻辑不变，仅换展示层 */
function ChatView({
  messages,
  currentSession,
  onSendMessage,
  isExecuting,
  onSaveAsTemplate,
  focusedFile,
  onClearFocus,
  onRevertToMessage,
  onOpenGeneratedFile,
  onDownloadGeneratedFile,
  onGoObservatory,
  progressPct,
}) {
  useSyncExternalStore(subscribe, getVersion)
  const [input, setInput] = useState('')
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
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
      const newHeight = input.trim() ? Math.min(Math.max(scrollHeight, 40), 160) : 40
      textarea.style.height = `${newHeight}px`
    }
  }, [input])

  const handleSend = () => {
    if (input.trim() && !isExecuting) {
      onSendMessage(input, { focusFile: focusedFile || undefined })
      setInput('')
      if (textareaRef.current) textareaRef.current.style.height = '40px'
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /* 归类横幅：仅新会话被归类后展示一次 */
  const classification = currentSession ? getClassification(currentSession.id) : null
  const showBanner = currentSession && classification && isFreshClassification(currentSession.id)
  const currentWs = currentSession ? workspaceOf(currentSession.id) : null
  const otherWorkspaces = getWorkspaces().filter(w => w.id !== currentWs?.id)

  /* 工作区记忆胶囊：规则抽取，抽不到不渲染 */
  const memory = useMemo(() => extractWorkspaceMemory(messages || []), [messages])

  const loadingMessage = messages.find(m => m.loading)

  const renderFilesCard = (message) => {
    const files = [...message.generated_files].sort((a, b) => {
      const aW = /\.docx?$/i.test(a.name)
      const bW = /\.docx?$/i.test(b.name)
      if (aW !== bW) return aW ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    return (
      <div className="cv-files-card">
        <div className="cv-files-head">已生成 {files.length} 个可交付文件</div>
        {files.map((file, fi) => {
          const isWord = /\.docx?$/i.test(file.name)
          return (
            <div key={fi} className="cv-file-row">
              <span className={`uk-file-tag cv-file-tag ${extClass(file.name)}`}>{extOf(file.name)}</span>
              <div className="cv-file-info">
                <div className="cv-file-name-row">
                  <span className="cv-file-name">{file.name}</span>
                  {isWord && <span className="cv-file-badge">Word 输出</span>}
                </div>
                <div className="cv-file-meta uk-mono">{formatFileSize(file.size)}</div>
              </div>
              <div className="cv-file-actions">
                <button onClick={() => onOpenGeneratedFile && onOpenGeneratedFile(file.name)}>打开</button>
                <button onClick={() => onDownloadGeneratedFile && onDownloadGeneratedFile(file.name)}>下载</button>
              </div>
            </div>
          )
        })}
        <div className="cv-files-replay" onClick={onGoObservatory}>
          <Orbit size={12} />
          在观测台回放这次执行 →
        </div>
      </div>
    )
  }

  return (
    <div className="cv-root">
      <div className="cv-scroll">
        <div className="cv-thread">
          {showBanner && (
            <div className="cv-banner">
              <Sparkles size={13} className="cv-banner-icon" />
              <div className="cv-banner-text">
                已自动归入工作区<b>「{currentWs?.name || ''}」</b>
                {classification.reason ? <> · 依据：{classification.reason}</> : null}
              </div>
              <div className="cv-banner-actions">
                <span className="cv-banner-btn" onClick={() => setMoveMenuOpen(!moveMenuOpen)}>移动</span>
                <span
                  className="cv-banner-btn"
                  onClick={() => extractToNewWorkspace(currentSession.id, currentSession)}
                >
                  独立新建
                </span>
                <span className="cv-banner-close" onClick={() => acknowledgeClassification(currentSession.id)}>
                  <X size={11} />
                </span>
              </div>
              {moveMenuOpen && (
                <div className="cv-move-menu">
                  {otherWorkspaces.length === 0 ? (
                    <div className="cv-move-empty">暂无其他工作区</div>
                  ) : (
                    otherWorkspaces.map(w => (
                      <div
                        key={w.id}
                        className="cv-move-item"
                        onClick={() => {
                          moveSessionToWorkspace(currentSession.id, w.id)
                          setMoveMenuOpen(false)
                        }}
                      >
                        {w.name}
                        <span className="uk-mono cv-move-tags">{w.tags.join(' ')}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {messages.length === 0 ? (
            <div className="cv-welcome">
              <h1 className="uk-serif">告诉我你的办公需求，我来自动处理</h1>
              <p>发送后会自动归入合适的工作区，执行全程可在观测台查看</p>
              <div className="cv-starters">
                {STARTERS.map(s => (
                  <span key={s} className="cv-starter" onClick={() => setInput(s)}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => {
              if (message.loading) {
                /* 执行中：内嵌实时观测卡（不再用旧折叠时间线） */
                return (
                  <div key={index} className="cv-live-card">
                    <span className="cv-live-dot" />
                    <div className="cv-live-body">
                      <div className="cv-live-title">{message.stageLabel || '正在处理'}…</div>
                      <div className="cv-live-track">
                        <div className="cv-live-bar" style={{ width: `${progressPct || 0}%` }} />
                      </div>
                    </div>
                    <span className="cv-live-link" onClick={onGoObservatory}>
                      <Orbit size={12} />
                      展开观测台 →
                    </span>
                  </div>
                )
              }
              const isUser = message.role === 'user'
              return (
                <div key={index} className={`cv-msg ${isUser ? 'user' : 'agent'}`}>
                  <div className="cv-msg-inner">
                    {isUser && message.timestamp && !isExecuting && (
                      <button
                        className="cv-revert"
                        title="回退到此消息之前的状态"
                        onClick={() => onRevertToMessage && onRevertToMessage(message.timestamp)}
                      >
                        <Undo2 size={11} />
                      </button>
                    )}
                    <div className="cv-bubble">
                      {!isUser && (
                        <div className="cv-agent-head">
                          <span className="cv-agent-dot" />
                          <span className="cv-agent-name">HELPER</span>
                        </div>
                      )}
                      <div className="cv-text">{message.content}</div>
                      {message.generated_files && message.generated_files.length > 0 && renderFilesCard(message)}
                      {message.success && message.generated_code && (
                        <div className="cv-save-tpl-row">
                          <span
                            className="cv-save-tpl"
                            title="保存为模板以便复用"
                            onClick={() => onSaveAsTemplate && onSaveAsTemplate(message)}
                          >
                            <Star size={11} />
                            保存为模板
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
          {/* 执行中但 loading 消息尚未建立时的兜底卡 */}
          {isExecuting && !loadingMessage && (
            <div className="cv-live-card">
              <span className="cv-live-dot" />
              <div className="cv-live-body">
                <div className="cv-live-title">正在执行…</div>
                <div className="cv-live-track">
                  <div className="cv-live-bar" style={{ width: `${progressPct || 0}%` }} />
                </div>
              </div>
              <span className="cv-live-link" onClick={onGoObservatory}>
                <Orbit size={12} />
                展开观测台 →
              </span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* composer */}
      <div className="cv-composer-wrap">
        <div className="cv-composer-inner">
          <div className="cv-chips-row">
            {memory.length > 0 && (
              <span className="cv-memory-chip uk-mono">
                <Diamond size={9} className="cv-memory-icon" />
                工作区记忆 · {memory.join(' · ')}
              </span>
            )}
            {focusedFile && (
              <span className="cv-focus-chip">
                聚焦：{focusedFile}
                <span className="cv-focus-clear" onClick={onClearFocus}>
                  <X size={10} />
                </span>
              </span>
            )}
          </div>
          <div className="cv-composer">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                currentSession
                  ? '继续这个对话 —— 助手已理解此前全部上下文…（Shift+Enter 换行）'
                  : '描述你的办公需求…（Shift+Enter 换行）'
              }
              rows={1}
              disabled={isExecuting}
            />
            <button
              className="cv-send uk-gold-btn"
              onClick={handleSend}
              disabled={isExecuting || !input.trim()}
              title={input.trim() ? '发送消息 (Enter)' : '请输入内容'}
            >
              <ArrowUp size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatView
