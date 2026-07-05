import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, ArrowUp, X } from 'lucide-react'
import {
  NODE_DEFS,
  EDGE_DEFS,
  VIEW_W,
  VIEW_H,
  deriveObservatory,
  edgePath,
} from '../utils/observatoryModel'
import { formatClock } from '../utils/ui'
import './Observatory.css'

const DOCK_MODES = [
  { id: 'task', label: '新任务' },
  { id: 'ask', label: '追问' },
  { id: 'add', label: '补充要求' },
]

const DOCK_PLACEHOLDERS = {
  task: '呼出新对话：描述需求，自动归入合适的工作区…',
  ask: '追问某一步做了什么，或结果为何这样…',
  add: '补充要求，例如「只算工作日」「保留两位小数」…',
}

/**
 * 观测台：现有 SSE → buildActivitySteps 的 ActivityStep 流的新展示层。
 * 全部状态由真实执行事件推导，无任何演示数据。
 */
function Observatory({
  steps,
  isExecuting,
  completed,
  started,
  deliveredCount,
  executionKey,
  currentSession,
  onSendMessage,
  focusedFile,
}) {
  const [selected, setSelected] = useState(null)
  const [milestone, setMilestone] = useState(null)
  const [dockInput, setDockInput] = useState('')
  const [dockMode, setDockMode] = useState('task')
  const milestoneTimer = useRef(null)
  const firedRef = useRef({ key: null, decide: false, firstWrite: false, completed: false })

  const model = useMemo(
    () => deriveObservatory({ steps: steps || [], executing: isExecuting, completed, started }),
    [steps, isExecuting, completed, started]
  )

  /* ─ 里程碑：真实事件触发（任务计划生成 / 首个输出文件写入 / 完成），无定时器伪造 ─ */
  useEffect(() => {
    const fired = firedRef.current
    if (fired.key !== executionKey) {
      firedRef.current = { key: executionKey, decide: false, firstWrite: false, completed: false }
    }
    const f = firedRef.current
    const show = (ms) => {
      setMilestone(ms)
      if (milestoneTimer.current) clearTimeout(milestoneTimer.current)
      milestoneTimer.current = setTimeout(() => setMilestone(null), 2700)
    }

    const decideNode = model.nodes.decide
    const writeNode = model.nodes.write

    if (isExecuting && !f.decide && decideNode.status !== 'pending') {
      f.decide = true
      show({ title: '需求已理清', detail: decideNode.steps[0]?.label || '任务计划已生成，开始处理' })
      return
    }
    const writeDone = writeNode.steps.some(s => s.status === 'completed')
    if (isExecuting && !f.firstWrite && writeDone) {
      f.firstWrite = true
      show({ title: '交付文件已生成', detail: writeNode.steps.find(s => s.status === 'completed')?.label || '首个输出文件已写入' })
      return
    }
    if (!f.completed && completed && f.key === executionKey && (f.decide || f.firstWrite)) {
      f.completed = true
      show({
        title: '任务完成',
        detail: deliveredCount > 0 ? `${deliveredCount} 份可交付文件已就绪，可打开或下载` : '执行已结束',
      })
    }
  }, [model, isExecuting, completed, executionKey, deliveredCount])

  useEffect(() => () => {
    if (milestoneTimer.current) clearTimeout(milestoneTimer.current)
  }, [])

  /* ─ 指令坞发送：走现有 handleSendMessage 管道，模式 chip 仅作消息前缀语义 ─ */
  const submitDock = () => {
    const q = dockInput.trim()
    if (!q || isExecuting) return
    const prefix = dockMode === 'ask' ? '追问：' : dockMode === 'add' ? '补充要求：' : ''
    onSendMessage(prefix + q, { focusFile: focusedFile || undefined })
    setDockInput('')
  }

  const askAboutNode = (node) => {
    setDockInput(`「${node.def.label}」这一步具体做了什么？`)
    setDockMode('ask')
    setSelected(null)
  }

  /* ─ feed：真实 ActivityStep 流，新条目在顶部 ─ */
  const feed = useMemo(() => {
    const list = (steps || []).map(s => {
      const node = NODE_DEFS.find(d => {
        const st = model.nodes[d.id]
        return st.steps.includes(s)
      })
      return {
        id: s.id,
        title: s.label,
        detail: s.detail,
        time: formatClock(s.timestamp),
        nodeId: node ? node.id : null,
        chip: node ? node.label : null,
        error: s.status === 'error',
      }
    })
    return list.reverse()
  }, [steps, model])

  /* ─ 看板 ─ */
  const kanban = useMemo(() => {
    const done = []
    const active = []
    const next = []
    for (const def of NODE_DEFS) {
      const st = model.nodes[def.id]
      const item = { id: def.id, label: def.label, meta: def.sub }
      if (st.status === 'done') done.push(item)
      else if (st.status === 'active') active.push(item)
      else next.push(item)
    }
    return { done, active, next }
  }, [model])

  const pct = model.pct
  const ringOffset = 169.6 - (169.6 * pct) / 100
  const phaseLabel = !model.hasStarted
    ? '待启动'
    : model.activeNode
      ? model.nodes[model.activeNode].def.label
      : completed
        ? '任务已完成'
        : isExecuting
          ? '理解需求'
          : '已停止'
  const etaLine = isExecuting
    ? '执行中 · 每步实时上报'
    : model.hasStarted
      ? `${model.doneCount}/${NODE_DEFS.length} 节点`
      : '下达需求后开始'

  const selNode = selected ? model.nodes[selected] : null

  return (
    <div className="obs-root">
      {/* ══ MAP STAGE ══ */}
      <div className="obs-stage" onClick={() => setSelected(null)}>
        <div className="obs-map-outer">
          <div className="obs-map-inner">
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet" className="obs-svg">
              <defs>
                <radialGradient id="ukNodeDone" cx="50%" cy="42%" r="60%">
                  <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="var(--gold)" stopOpacity="0.07" />
                </radialGradient>
              </defs>
              {EDGE_DEFS.map(([a, b]) => {
                const A = NODE_DEFS.find(n => n.id === a)
                const B = NODE_DEFS.find(n => n.id === b)
                const sa = model.nodes[a].status
                const sb = model.nodes[b].status
                const bothDone = sa === 'done' && sb === 'done'
                const live = (sa === 'done' || sa === 'active') && sb === 'active'
                return (
                  <path
                    key={`${a}-${b}`}
                    d={edgePath(A, B)}
                    fill="none"
                    stroke={live ? 'var(--gold)' : bothDone ? 'var(--gold-line)' : 'var(--line2)'}
                    strokeWidth={live ? 1.8 : 1.2}
                    opacity={live ? 0.95 : bothDone ? 0.7 : 0.5}
                    strokeDasharray={live ? '6 8' : 'none'}
                    className={live ? 'uk-anim-dashflow obs-edge-live' : ''}
                  />
                )
              })}
              {NODE_DEFS.map(def => {
                const st = model.nodes[def.id]
                const done = st.status === 'done'
                const active = st.status === 'active'
                const isSel = selected === def.id
                return (
                  <g
                    key={def.id}
                    className="obs-node-g"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelected(def.id)
                    }}
                  >
                    {active && (
                      <circle
                        cx={def.x}
                        cy={def.y}
                        r={36}
                        fill="none"
                        stroke={def.role}
                        strokeWidth={2}
                        className="uk-anim-ringpulse obs-ringpulse"
                      />
                    )}
                    <circle
                      cx={def.x}
                      cy={def.y}
                      r={32}
                      fill={done ? 'url(#ukNodeDone)' : active ? 'var(--gold-dim)' : 'transparent'}
                      stroke={done || active ? def.role : 'var(--line2)'}
                      strokeWidth={isSel ? 2.5 : done || active ? 1.8 : 1.2}
                      style={
                        active
                          ? { filter: `drop-shadow(0 0 10px ${def.role})` }
                          : done
                            ? { filter: 'drop-shadow(0 0 4px var(--gold-glow-soft))' }
                            : undefined
                      }
                    />
                    {done && <circle cx={def.x} cy={def.y} r={7} fill={def.role} />}
                    {active && <circle cx={def.x} cy={def.y} r={9} fill={def.role} className="obs-node-breathe" />}
                  </g>
                )
              })}
            </svg>
            {/* 节点文字：HTML overlay 层 */}
            <div className="obs-labels">
              {NODE_DEFS.map(def => {
                const st = model.nodes[def.id]
                const lit = st.status !== 'pending'
                return (
                  <div
                    key={def.id}
                    className="obs-label"
                    style={{
                      left: `${((def.x / VIEW_W) * 100).toFixed(2)}%`,
                      top: `${(((def.y + 40) / VIEW_H) * 100).toFixed(2)}%`,
                    }}
                  >
                    <div className={`obs-label-name ${lit ? 'lit' : ''}`}>{def.label}</div>
                    <div className="obs-label-sub uk-mono">{def.sub}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 图例 */}
        <div className="obs-legend">
          <span className="obs-legend-item"><span className="obs-legend-dot done" />已完成</span>
          <span className="obs-legend-item"><span className="obs-legend-dot live" />执行中</span>
          <span className="obs-legend-item"><span className="obs-legend-dot pending" />待执行</span>
        </div>

        {/* 节点详情卡 */}
        {selNode && (
          <aside className="obs-node-card" onClick={(e) => e.stopPropagation()}>
            <div className="obs-node-card-head">
              <span className="obs-node-card-dot" style={{ background: selNode.def.role }} />
              <span className="obs-node-card-title">{selNode.def.label}</span>
              <button className="obs-node-card-close" onClick={() => setSelected(null)}>
                <X size={13} />
              </button>
            </div>
            <div className="obs-node-card-sub uk-mono">
              {selNode.def.sub} · {selNode.status === 'done' ? '已完成' : selNode.status === 'active' ? '执行中' : '待执行'}
            </div>
            <div className="obs-node-card-desc">
              {selNode.steps.length > 0 ? selNode.steps[selNode.steps.length - 1].label : selNode.def.desc}
            </div>
            <div className="obs-node-card-files">
              <div className="obs-node-card-files-title">关联文件</div>
              {selNode.files.length > 0 ? (
                selNode.files.map(f => (
                  <div key={f} className="obs-node-card-file uk-mono">{f}</div>
                ))
              ) : (
                <div className="obs-node-card-file uk-mono empty">暂无关联文件</div>
              )}
            </div>
            <div className="obs-node-card-actions">
              <button className="obs-ask-btn" onClick={() => askAboutNode(selNode)}>
                <Sparkles size={12} />
                追问这一步做了什么
              </button>
              {selNode.status === 'pending' && (
                /* TODO: 优先执行需要执行引擎支持任务重排，当前置灰占位 */
                <button className="obs-prioritize-btn" disabled title="即将支持">
                  <ArrowUp size={12} />
                  优先执行此步
                </button>
              )}
            </div>
          </aside>
        )}

        {/* 里程碑 */}
        {milestone && (
          <div className="obs-milestone">
            <div className="obs-milestone-card">
              <div className="obs-milestone-sweep-clip">
                <div className="obs-milestone-sweep uk-anim-sweep" />
              </div>
              <div className="obs-milestone-kicker">MILESTONE</div>
              <div className="obs-milestone-title uk-serif">{milestone.title}</div>
              <div className="obs-milestone-detail">{milestone.detail}</div>
            </div>
          </div>
        )}

        {/* 指令坞 */}
        <div className="obs-dock" onClick={(e) => e.stopPropagation()}>
          <div className="obs-dock-card">
            <div className="obs-dock-row">
              <span className={`obs-dock-dot ${isExecuting ? 'busy' : 'idle'}`} />
              <input
                value={dockInput}
                onChange={(e) => setDockInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submitDock()
                  }
                }}
                placeholder={
                  isExecuting
                    ? '任务执行中 · 可切到对话查看，或点击右上角停止'
                    : model.hasStarted
                      ? DOCK_PLACEHOLDERS[dockMode]
                      : '下达需求后每一步在此点亮'
                }
                disabled={isExecuting}
              />
              <button className="obs-dock-send uk-gold-btn" onClick={submitDock} disabled={isExecuting || !dockInput.trim()}>
                发送
              </button>
            </div>
            <div className="obs-dock-modes">
              {DOCK_MODES.map(m => (
                <span
                  key={m.id}
                  className={`obs-dock-mode ${dockMode === m.id ? 'on' : ''}`}
                  onClick={() => setDockMode(m.id)}
                >
                  {m.label}
                </span>
              ))}
              <span className="obs-dock-hint">发送后自动归入工作区 · ⌘↵</span>
            </div>
          </div>
        </div>
      </div>

      {/* ══ RIGHT RAIL ══ */}
      <aside className="obs-rail">
        <div className="obs-rail-progress">
          <div className="obs-ring">
            <svg viewBox="0 0 62 62">
              <circle cx="31" cy="31" r="27" fill="none" stroke="var(--line)" strokeWidth="4" />
              <circle
                cx="31"
                cy="31"
                r="27"
                fill="none"
                stroke="var(--gold)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray="169.6"
                strokeDashoffset={ringOffset}
                className="obs-ring-arc"
              />
            </svg>
            <div className="obs-ring-num uk-mono">
              {pct}
              <span>%</span>
            </div>
          </div>
          <div className="obs-rail-phase">
            <div className="uk-kicker">任务进度</div>
            <div className="obs-phase-name uk-serif">{phaseLabel}</div>
            <div className="obs-phase-eta">{etaLine}</div>
          </div>
        </div>

        <div className="obs-kanban">
          {[
            { title: '已完成', dotClass: 'good', items: kanban.done.slice(-3), count: kanban.done.length },
            {
              title: '进行中',
              dotClass: 'gold',
              items: kanban.active.length
                ? kanban.active
                : [{ id: null, label: completed ? '本轮任务已完成' : '等待执行指令', meta: '—' }],
              count: kanban.active.length,
            },
            { title: '下一步', dotClass: 'dim', items: kanban.next.slice(0, 3), count: kanban.next.length },
          ].map(col => (
            <div key={col.title} className="obs-kanban-col">
              <div className="obs-kanban-head">
                <span className={`obs-kanban-dot ${col.dotClass}`} />
                <span className="obs-kanban-title">{col.title}</span>
                <span className="obs-kanban-count uk-mono">{col.count}</span>
              </div>
              {col.items.map((it, i) => (
                <div
                  key={it.id || i}
                  className={`obs-kanban-item ${it.id && model.nodes[it.id].status === 'active' ? 'active' : ''} ${!it.id ? 'placeholder' : ''}`}
                  onClick={() => it.id && setSelected(it.id)}
                >
                  <span className="obs-kanban-label">{it.label}</span>
                  <span className="obs-kanban-meta uk-mono">{it.meta}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="obs-feed-wrap">
          <div className="obs-feed-head">
            <span className="obs-feed-title">实时轨迹</span>
            <span className="obs-feed-tag uk-mono">LIVE FEED</span>
            {isExecuting && <span className="obs-feed-live" />}
          </div>
          <div className="obs-feed">
            {feed.length === 0 ? (
              <div className="obs-feed-item">
                <span className="obs-feed-dot pending" />
                <div className="obs-feed-item-row">
                  <span className="obs-feed-item-title dim">等待接入</span>
                  <span className="obs-feed-item-time uk-mono">--:--</span>
                </div>
                <div className="obs-feed-item-detail">
                  {currentSession
                    ? '在下方指令坞下达需求 —— 每一步都会在这里和地图上点亮。'
                    : '发起第一个对话，执行轨迹会在这里实时点亮。'}
                </div>
              </div>
            ) : (
              feed.map(ev => (
                <div key={ev.id} className="obs-feed-item">
                  <span className={`obs-feed-dot ${ev.error ? 'error' : ''}`} />
                  <span className="obs-feed-rail" />
                  <div className="obs-feed-item-row">
                    <span className="obs-feed-item-title">{ev.title}</span>
                    <span className="obs-feed-item-time uk-mono">{ev.time}</span>
                  </div>
                  {ev.detail && <div className="obs-feed-item-detail">{ev.detail}</div>}
                  {ev.chip && (
                    <span className="obs-feed-chip uk-mono" onClick={() => setSelected(ev.nodeId)}>
                      {ev.chip}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

export default Observatory
