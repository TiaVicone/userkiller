import React, { useSyncExternalStore } from 'react'
import { Orbit, Quote, StopCircle } from 'lucide-react'
import { subscribe, getVersion, workspaceOf } from '../utils/workspaceStore'
import './WorkHeader.css'

/** 主区 header（54px）：serif 会话标题 + 工作区 chip + 标签串 + 观测台/对话分段切换 + 执行中的停止按钮 */
function WorkHeader({ currentSession, mode, onSetMode, isExecuting, onStop }) {
  useSyncExternalStore(subscribe, getVersion)
  const ws = currentSession ? workspaceOf(currentSession.id) : null

  const handleStop = async () => {
    if (!currentSession || !isExecuting) return
    if (!confirm('确定要停止当前任务吗？已完成的步骤将被保留。')) return
    if (onStop) await onStop(currentSession.id)
  }

  return (
    <header className="wh-header">
      <div className="wh-left">
        <span className="wh-title uk-serif">{currentSession ? currentSession.name : '新的一天，从一句需求开始'}</span>
        {ws && <span className="wh-ws-chip">{ws.name}</span>}
        {ws && ws.tags.length > 0 && (
          <span className="wh-tags uk-mono">{ws.tags.join(' ')}</span>
        )}
      </div>
      <div className="wh-right">
        <div className="wh-seg">
          <span
            className={`wh-seg-item ${mode === 'obs' ? 'on' : ''}`}
            onClick={() => onSetMode('obs')}
          >
            <Orbit size={12} />
            观测台
            {isExecuting && <span className="wh-seg-live" />}
          </span>
          <span
            className={`wh-seg-item ${mode === 'chat' ? 'on' : ''}`}
            onClick={() => onSetMode('chat')}
          >
            <Quote size={12} />
            对话
          </span>
        </div>
        {isExecuting && (
          <button className="wh-stop uk-ghost-btn" onClick={handleStop} title="停止当前任务">
            <StopCircle size={13} />
            停止
          </button>
        )}
      </div>
    </header>
  )
}

export default WorkHeader
