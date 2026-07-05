import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Search, PlusCircle, Quote } from 'lucide-react'
import api from '../utils/api'
import {
  subscribe,
  getVersion,
  getWorkspaces,
  workspaceDot,
  getSnippet,
  setSnippet,
} from '../utils/workspaceStore'
import { formatDay } from '../utils/ui'
import './ConvoFinder.css'

/** ⌘K 对话查找器：搜索会话名 + 首条消息摘要 + 标签（现有 list 数据 + 前端工作区元数据） */
function ConvoFinder({ sessions, currentSession, onClose, onOpenSession, onCreateSession }) {
  useSyncExternalStore(subscribe, getVersion)
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState('全部')
  const [cursor, setCursor] = useState(-1)
  const inputRef = useRef(null)
  const fetchedRef = useRef(new Set())

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  /* 懒加载会话首条消息作摘要（缓存到 localStorage） */
  useEffect(() => {
    let cancelled = false
    const missing = sessions.filter(s => getSnippet(s.id) === null && !fetchedRef.current.has(s.id)).slice(0, 20)
    missing.forEach(s => fetchedRef.current.add(s.id))
    ;(async () => {
      for (const s of missing) {
        if (cancelled) return
        try {
          const msgs = await api.session.getMessages(s.id)
          const first = (msgs || []).find(m => m.role === 'user')
          setSnippet(s.id, first?.content || '')
        } catch {
          /* 摘要获取失败时静默跳过 */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessions])

  const workspaces = getWorkspaces()
  const sessionById = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions])

  const allTags = useMemo(() => {
    const tags = []
    workspaces.forEach(w => w.tags.forEach(t => {
      if (!tags.includes(t)) tags.push(t)
    }))
    return ['全部', ...tags]
  }, [workspaces])

  const q = query.trim().toLowerCase()

  const groups = useMemo(() => {
    const assigned = new Set()
    const result = []
    const matches = (s, ws) => {
      const snippet = getSnippet(s.id) || ''
      const hay = `${s.name} ${snippet} ${ws ? ws.name + ' ' + ws.tags.join(' ') : ''}`.toLowerCase()
      if (q && !hay.includes(q)) return false
      if (activeTag !== '全部' && (!ws || !ws.tags.includes(activeTag))) return false
      return true
    }
    for (const ws of workspaces) {
      const items = ws.sessionIds
        .map(id => sessionById.get(id))
        .filter(Boolean)
        .filter(s => {
          assigned.add(s.id)
          return matches(s, ws)
        })
      if (items.length > 0) result.push({ ws, items })
    }
    const rest = sessions.filter(s => !assigned.has(s.id)).filter(s => matches(s, null))
    if (rest.length > 0 && activeTag === '全部') result.push({ ws: null, items: rest })
    return result
  }, [workspaces, sessions, sessionById, q, activeTag])

  const flat = useMemo(() => groups.flatMap(g => g.items), [groups])

  const openItem = (s) => {
    onOpenSession(s)
    onClose()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (cursor >= 0 && flat[cursor]) openItem(flat[cursor])
      else if (flat.length > 0) openItem(flat[0])
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const i = allTags.indexOf(activeTag)
      setActiveTag(allTags[(i + 1) % allTags.length])
      setCursor(-1)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="cf-scrim" onClick={onClose}>
      <div className="cf-card" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="cf-search-row">
          <Search size={14} className="cf-search-icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(-1)
            }}
            placeholder="搜索对话、工作区、标签…"
          />
          <span className="cf-esc uk-mono" onClick={onClose}>esc</span>
        </div>

        <div className="cf-tags">
          {allTags.map(t => (
            <span
              key={t}
              className={`cf-tag uk-mono ${activeTag === t ? 'on' : ''}`}
              onClick={() => {
                setActiveTag(t)
                setCursor(-1)
              }}
            >
              {t}
            </span>
          ))}
        </div>

        <div className="cf-body">
          <div
            className="cf-new"
            onClick={() => {
              onCreateSession()
              onClose()
            }}
          >
            <PlusCircle size={13} className="cf-new-icon" />
            <span className="cf-new-label">开始新对话</span>
            <span className="cf-new-hint">发送后自动判断归属工作区</span>
          </div>

          {groups.length === 0 && (
            <div className="cf-empty">
              没有匹配的对话
              <span>换个关键词，或切换上方标签试试</span>
            </div>
          )}

          {groups.map((g, gi) => (
            <div key={g.ws ? g.ws.id : `rest-${gi}`} className="cf-group">
              <div className="cf-group-head">
                <span
                  className="cf-group-dot"
                  style={g.ws ? { background: workspaceDot(g.ws.id) } : undefined}
                />
                <span className="cf-group-name">{g.ws ? g.ws.name : '未归类'}</span>
                {g.ws && <span className="cf-group-tags uk-mono">{g.ws.tags.join(' ')}</span>}
              </div>
              {g.items.map(s => {
                const idx = flat.indexOf(s)
                const isCurrent = currentSession?.id === s.id
                const snippet = getSnippet(s.id)
                return (
                  <div
                    key={s.id}
                    className={`cf-item ${idx === cursor ? 'cursor' : ''} ${isCurrent ? 'current' : ''}`}
                    onClick={() => openItem(s)}
                    onMouseEnter={() => setCursor(idx)}
                  >
                    <Quote size={12} className="cf-item-quote" />
                    <div className="cf-item-main">
                      <div className="cf-item-title-row">
                        <span className="cf-item-title">{s.name}</span>
                        {isCurrent && <span className="cf-item-live uk-mono">当前</span>}
                      </div>
                      {snippet && <div className="cf-item-snippet">{snippet}</div>}
                    </div>
                    <div className="cf-item-right">
                      <div className="cf-item-time uk-mono">{formatDay(s.updated_at)}</div>
                      <div className="cf-item-continue">↵ 继续对话 · 保留上下文</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="cf-footer uk-mono">
          <span>↑↓ 选择</span>
          <span>↵ 打开</span>
          <span>tab 切换标签</span>
          <span className="cf-footer-right">对话自动归档，不会丢失</span>
        </div>
      </div>
    </div>
  )
}

export default ConvoFinder
