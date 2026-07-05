import React, { useState, useSyncExternalStore } from 'react'
import { Search, Plus, BookTemplate, Sun, Moon, Trash2, Sparkles, Quote } from 'lucide-react'
import {
  subscribe,
  getVersion,
  getWorkspaces,
  workspaceDot,
} from '../utils/workspaceStore'
import { formatDay } from '../utils/ui'
import './WorkspaceSidebar.css'

/** 左侧栏：工作区（自动归类）会话导航 */
function WorkspaceSidebar({
  sessions,
  currentSession,
  isExecuting,
  onSelectSession,
  onDeleteSession,
  onCreateSession,
  onOpenFinder,
  onOpenTemplates,
  templatesOpen,
  theme,
  onToggleTheme,
}) {
  useSyncExternalStore(subscribe, getVersion)
  const [expandedWs, setExpandedWs] = useState(null)

  const workspaces = getWorkspaces()
  const sessionById = new Map(sessions.map(s => [s.id, s]))
  const assigned = new Set()
  workspaces.forEach(w => w.sessionIds.forEach(id => assigned.add(id)))
  const unassigned = sessions.filter(s => !assigned.has(s.id))

  const activeWsId = workspaces.find(w => currentSession && w.sessionIds.includes(currentSession.id))?.id || null
  const visibleWorkspaces = workspaces
    .map(w => ({ ...w, convos: w.sessionIds.map(id => sessionById.get(id)).filter(Boolean) }))
    .filter(w => w.convos.length > 0)

  const renderConvo = (s) => {
    const active = currentSession?.id === s.id
    return (
      <div
        key={s.id}
        className={`ws-convo ${active ? 'active' : ''}`}
        onClick={() => onSelectSession(s)}
      >
        <Quote size={11} className="ws-convo-quote" />
        <span className="ws-convo-title">{s.name}</span>
        <span className="ws-convo-time uk-mono">{formatDay(s.updated_at)}</span>
        <button
          className="ws-convo-del"
          title="删除会话"
          onClick={(e) => {
            e.stopPropagation()
            onDeleteSession(s.id)
          }}
        >
          <Trash2 size={11} />
        </button>
      </div>
    )
  }

  return (
    <nav className="ws-sidebar">
      <div className="ws-brand">
        <span className="ws-brand-dot" />
        <span className="ws-brand-name uk-serif">userkiller</span>
        <span className="ws-brand-ver uk-mono">v2</span>
      </div>
      <div className="ws-brand-sub">AI 自动化办公助手</div>

      <div className="ws-search" onClick={onOpenFinder}>
        <Search size={13} className="ws-search-icon" />
        <span className="ws-search-hint">搜索对话、标签…</span>
        <span className="ws-search-kbd uk-mono">⌘K</span>
      </div>

      <div className="ws-scroll">
        <div className="ws-group-head">
          <span className="ws-group-title">工作区</span>
          <span className="ws-group-ai">
            <Sparkles size={10} />
            AI 自动归类
          </span>
          <button className="ws-new-btn" title="新对话" onClick={onCreateSession}>
            <Plus size={13} />
          </button>
        </div>

        {visibleWorkspaces.length === 0 && unassigned.length === 0 && (
          <div className="ws-empty">还没有工作区 — 发起第一个对话，它会被自动归类</div>
        )}

        {visibleWorkspaces.map(ws => {
          const expanded = expandedWs === ws.id || ws.id === activeWsId
          const isActive = ws.id === activeWsId
          return (
            <div key={ws.id} className={`ws-card ${isActive ? 'active' : ''}`}>
              <div
                className="ws-card-head"
                onClick={() => setExpandedWs(expandedWs === ws.id ? null : ws.id)}
              >
                <div className="ws-card-row">
                  <span className="ws-card-dot" style={{ background: workspaceDot(ws.id) }} />
                  <span className="ws-card-name">{ws.name}</span>
                  {isActive && isExecuting && <span className="ws-card-live" />}
                  <span className="ws-card-count uk-mono">{ws.convos.length}</span>
                </div>
                {ws.tags.length > 0 && (
                  <div className="ws-card-tags">
                    {ws.tags.map(t => (
                      <span key={t} className="ws-tag uk-mono">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              {expanded && (
                <div className="ws-card-convos">
                  {ws.convos.map(renderConvo)}
                </div>
              )}
            </div>
          )
        })}

        {unassigned.length > 0 && (
          <div className="ws-card">
            <div className="ws-card-head">
              <div className="ws-card-row">
                <span className="ws-card-dot ws-card-dot--hollow" />
                <span className="ws-card-name">未归类</span>
                <span className="ws-card-count uk-mono">{unassigned.length}</span>
              </div>
            </div>
            <div className="ws-card-convos">{unassigned.map(renderConvo)}</div>
          </div>
        )}

        <div className="ws-view-all" onClick={onOpenFinder}>查看全部对话 →</div>

        <div className="ws-nav-sep">
          <div
            className={`ws-nav-item ${templatesOpen ? 'active' : ''}`}
            onClick={onOpenTemplates}
          >
            <BookTemplate size={13} className="ws-nav-icon" />
            <span>模板库</span>
            <span className="ws-nav-kbd uk-mono">⌘T</span>
          </div>
        </div>
      </div>

      <div className="ws-footer">
        <div className="ws-avatar">用</div>
        <div className="ws-user">
          <div className="ws-user-name">办公用户</div>
          <div className="ws-user-meta">DeepSeek · 本地工作区</div>
        </div>
        <button className="ws-theme-btn" title="切换主题" onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>
    </nav>
  )
}

export default WorkspaceSidebar
