// 观测台数据模型：把现有 SSE → buildActivitySteps 的 ActivityStep 流
// 实时推导为 8 节点管线的状态。纯前端派生层，不触碰任何 API。
import type { ActivityStep } from '../types'

export type NodeId =
  | 'understand'
  | 'observe'
  | 'read'
  | 'decide'
  | 'python'
  | 'write'
  | 'validate'
  | 'output'

export interface NodeDef {
  id: NodeId
  label: string
  sub: string
  role: string
  x: number
  y: number
  desc: string
}

export type NodeStatus = 'pending' | 'active' | 'done'

export interface NodeState {
  def: NodeDef
  status: NodeStatus
  steps: ActivityStep[]
  files: string[]
}

export const NODE_DEFS: NodeDef[] = [
  { id: 'understand', label: '理解需求', sub: 'UNDERSTAND', role: 'var(--role-understand)', x: 82, y: 285, desc: '解析你的自然语言目标，确定任务范围与期望产出。' },
  { id: 'observe', label: '观察工作区', sub: 'OBSERVE', role: 'var(--role-observe)', x: 248, y: 150, desc: '扫描会话工作区，发现输入文件并识别其类型。' },
  { id: 'read', label: '读取分析', sub: 'INSPECT', role: 'var(--role-read)', x: 248, y: 425, desc: '预览表格与文档结构，识别表头、规模与字段。' },
  { id: 'decide', label: '决策规划', sub: 'PLAN', role: 'var(--role-decide)', x: 425, y: 285, desc: '匹配技能并拆分执行计划，决定处理路径。' },
  { id: 'python', label: '执行处理', sub: 'PYTHON', role: 'var(--role-python)', x: 600, y: 150, desc: '运行脚本与工具，完成核心数据处理。' },
  { id: 'write', label: '生成结果', sub: 'WRITE', role: 'var(--role-write)', x: 610, y: 425, desc: '写入结果文件，生成可交付产物。' },
  { id: 'validate', label: '校验输出', sub: 'VERIFY', role: 'var(--role-validate)', x: 762, y: 250, desc: '校验字段完整性与数值一致性，确认交付无缺失。' },
  { id: 'output', label: '交付下载', sub: 'OUTPUT', role: 'var(--role-output)', x: 856, y: 415, desc: '成品写入输出区，可直接打开或下载。' },
]

export const EDGE_DEFS: Array<[NodeId, NodeId]> = [
  ['understand', 'observe'],
  ['understand', 'read'],
  ['observe', 'decide'],
  ['read', 'decide'],
  ['decide', 'python'],
  ['decide', 'write'],
  ['python', 'write'],
  ['python', 'validate'],
  ['write', 'validate'],
  ['validate', 'output'],
]

export const VIEW_W = 920
export const VIEW_H = 560

/** 单个 ActivityStep 映射到管线节点 */
export function mapStepToNode(step: ActivityStep): NodeId | null {
  const text = `${step.label || ''} ${step.detail || ''}`
  if (/校验|fill-report/i.test(text)) return 'validate'
  if (/扫描工作区/.test(step.label || '')) return 'observe'
  switch (step.type) {
    case 'file_read':
      return 'read'
    case 'file_write':
      return 'write'
    case 'skill_match':
      return 'decide'
    case 'tool':
      if (/匹配字段/.test(step.label || '')) return 'decide'
      return 'python'
    default:
      return null
  }
}

const FILE_RE = /[\w一-龥()（）【】\-. ]{1,40}\.(?:xlsx?|docx?|csv|pdf|png|jpe?g|gif|md|json|py|txt)/gi

function extractFiles(steps: ActivityStep[]): string[] {
  const out: string[] = []
  for (const s of steps) {
    const text = `${s.label || ''} ${s.detail || ''}`
    const matches = text.match(FILE_RE)
    if (matches) {
      for (const m of matches) {
        const clean = m.trim()
        if (clean && !out.includes(clean)) out.push(clean)
      }
    }
  }
  return out.slice(0, 4)
}

export interface ObservatoryState {
  nodes: Record<NodeId, NodeState>
  /** 已点亮（done）节点数，用于进度环 completed/8 */
  doneCount: number
  pct: number
  /** 当前 active 的节点（用于阶段名） */
  activeNode: NodeId | null
  hasStarted: boolean
}

export interface DeriveInput {
  steps: ActivityStep[]
  /** 正在执行（存在 loading 消息） */
  executing: boolean
  /** 本次执行已成功完成（status=completed，generated_files 到达） */
  completed: boolean
  /** 执行已开始（stageLabel 出现过 / 有任何 step） */
  started: boolean
}

/** 由 ActivityStep 流实时推导 8 节点状态；无任务时全部 pending */
export function deriveObservatory(input: DeriveInput): ObservatoryState {
  const { steps, executing, completed, started } = input
  const byNode = new Map<NodeId, ActivityStep[]>()
  let lastNode: NodeId | null = null
  for (const s of steps) {
    const id = mapStepToNode(s)
    if (!id) continue
    const arr = byNode.get(id) || []
    arr.push(s)
    byNode.set(id, arr)
    lastNode = id
  }

  const nodes = {} as Record<NodeId, NodeState>
  let activeNode: NodeId | null = null

  for (const def of NODE_DEFS) {
    const nodeSteps = byNode.get(def.id) || []
    let status: NodeStatus = 'pending'

    if (def.id === 'understand') {
      if (started || steps.length > 0) {
        status = executing && byNode.size === 0 ? 'active' : 'done'
      }
    } else if (def.id === 'output') {
      status = completed ? 'done' : 'pending'
    } else if (nodeSteps.length > 0) {
      const hasRunning = nodeSteps.some(s => s.status === 'running')
      if (executing && (hasRunning || def.id === lastNode)) status = 'active'
      else status = 'done'
    }

    if (status === 'active') activeNode = def.id
    nodes[def.id] = { def, status, steps: nodeSteps, files: extractFiles(nodeSteps) }
  }

  // 执行完成后，全部有事件的节点收敛为 done
  if (completed) {
    for (const def of NODE_DEFS) {
      if (nodes[def.id].status === 'active') nodes[def.id].status = 'done'
    }
    activeNode = null
  }

  const doneCount = NODE_DEFS.filter(d => nodes[d.id].status === 'done').length
  return {
    nodes,
    doneCount,
    pct: Math.round((doneCount / NODE_DEFS.length) * 100),
    activeNode,
    hasStarted: started || steps.length > 0,
  }
}

/** 贝塞尔边路径：M ax ay C mx ay, mx by, bx by */
export function edgePath(a: NodeDef, b: NodeDef): string {
  const mx = (a.x + b.x) / 2
  return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`
}
