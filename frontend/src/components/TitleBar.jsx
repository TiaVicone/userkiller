import React from 'react'
import { BookTemplate, Settings } from 'lucide-react'
import './TitleBar.css'

function TitleBar({ currentSession, onOpenTemplates, templateMode }) {
  return (
    <div className="title-bar">
      <div className="title-bar-drag-region">
        <div className="title-bar-content">
          <span className="app-title">AI自动化办公助手</span>
          {currentSession && (
            <>
              <span className="title-separator">|</span>
              <span className="session-name">{currentSession.name}</span>
            </>
          )}
        </div>
        
        <div className="title-bar-actions">
          {templateMode === 'modal' && (
            <button 
              className="title-bar-btn template-btn"
              onClick={onOpenTemplates}
              title="模板库 (Ctrl+T)"
            >
              <BookTemplate size={18} />
              <span>模板</span>
            </button>
          )}
          
          <button 
            className="title-bar-btn settings-btn"
            title="设置"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default TitleBar
