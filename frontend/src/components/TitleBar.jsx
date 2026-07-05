import React from 'react'
import './TitleBar.css'

/** 细条标题栏：保留 Electron 拖拽区（-webkit-app-region: drag） */
function TitleBar({ currentSession }) {
  return (
    <div className="title-bar">
      <div className="title-bar-drag-region">
        <div className="title-bar-content">
          <span className="title-dot" />
          <span className="app-title uk-serif">userkiller</span>
          {currentSession && (
            <>
              <span className="title-separator">·</span>
              <span className="session-name">{currentSession.name}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default TitleBar
