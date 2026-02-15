import React from 'react'
import { Plus, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import './SessionSidebar.css'

function SessionSidebar({ sessions, currentSession, isOpen, onToggle, onSelectSession, onDeleteSession, onCreateSession }) {
  const handleCreate = () => {
    // 直接创建新会话，不需要用户输入
    onCreateSession()
  }

  return (
    <div className={`session-sidebar ${isOpen ? 'open' : 'closed'}`}>
      <div className="sidebar-header">
        <button className="toggle-btn" onClick={onToggle}>
          {isOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
        {isOpen && (
          <button className="new-session-btn" onClick={handleCreate} title="新建会话">
            <Plus size={20} />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="sessions-list">
          {sessions.length === 0 ? (
            <div className="empty-state">
              <p>暂无会话</p>
              <p className="hint">点击上方 + 号创建新会话</p>
            </div>
          ) : (
            sessions.map(session => (
              <div
                key={session.id}
                className={`session-item ${currentSession?.id === session.id ? 'active' : ''}`}
                onClick={() => onSelectSession(session)}
              >
                <div className="session-name">{session.name}</div>
                <button
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm('确定要删除这个会话吗？')) {
                      onDeleteSession(session.id)
                    }
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default SessionSidebar

