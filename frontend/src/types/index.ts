// 会话相关类型
export interface Session {
  id: string
  name: string
  created_at: string
  updated_at: string
  status: 'idle' | 'executing' | 'completed' | 'error' | 'stopped' | 'awaiting_clarification'
  workspace_path: string
  output_path: string
  messages?: ChatMessage[]
  result?: ExecutionResult
  error?: string
}

/** 实时执行过程中的单个活动步骤 */
export interface ActivityStep {
  id: string
  type: 'tool' | 'decision' | 'stage' | 'log' | 'file_read' | 'file_write' | 'skill_match' | 'clarification'
  icon: string
  label: string
  detail?: string
  status: 'running' | 'completed' | 'error'
  timestamp: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  loading?: boolean
  success?: boolean
  workflow_steps?: WorkflowStep[]
  logs?: ExecutionLog[]
  generated_code?: string
  generated_files?: Array<{ name: string; size: number; path: string }>
  /** Cursor-style real-time activity timeline */
  activitySteps?: ActivityStep[]
  /** Current high-level stage label */
  stageLabel?: string
  /** Accumulated progress data from backend polling */
  progress?: {
    task_stage?: string
    task_stage_label?: string
    latest_log?: ExecutionLog & { step_label: string } | null
    logs?: Array<ExecutionLog & { step_label: string }>
    workflow_steps?: Array<WorkflowStep & { module_label: string }>
    message?: string
  }
}

export interface ExecutionResult {
  message: string
  workflow_steps: WorkflowStep[]
  logs: ExecutionLog[]
  success: boolean
  generatedCode?: string
  taskDescription?: string
  clarificationRequest?: string
  taskState?: any
}

export interface WorkflowStep {
  module: string
  module_label?: string
  status: 'running' | 'completed' | 'error'
  output: string
  code?: string
}

export interface ExecutionLog {
  step: string
  step_label?: string
  status: 'info' | 'error' | 'warning'
  content: string
  timestamp: string
}

// 文件相关类型
export interface FileInfo {
  name: string
  path: string
  size: number
  modified_at: string
}

export interface SpreadsheetPreview {
  file: string
  preview: {
    sheets: Array<{
      name: string
      rowCount: number
      colCount: number
      sample: any[][]
    }>
  }
}

// 模板相关类型
export interface Template {
  id: string
  name: string
  description: string
  task_description: string
  code: string
  file_info: Array<{ name: string; type: string }>
  output_files: Array<{ name: string; filename?: string }>
  tags: string[]
  usage_count: number
  success_count: number
  created_at: string
  updated_at: string
}

// 技能相关类型
export interface Skill {
  id: string
  name: string
  description: string
  keywords: string[]
  file_extensions: string[]
  tags: string[]
  usage_count: number
  success_count: number
  created_at: string
  updated_at: string
}

export interface SkillMatch {
  skill: Skill
  score: number
  reason: string
}

// API 响应类型
export interface ApiResponse<T = unknown> {
  success: boolean
  error?: string
  data?: T
  [key: string]: any
}

export interface SessionListResponse {
  sessions: Session[]
}

export interface SessionCreateResponse {
  success: boolean
  session_id: string
  session_name: string
  workspace_path: string
  output_path: string
}

export interface MessagesResponse {
  messages: ChatMessage[]
}

export interface FilesResponse {
  workspace: FileInfo[]
  output: FileInfo[]
  previews: SpreadsheetPreview[]
}

export interface ExecutionStatusResponse {
  status: 'executing' | 'completed' | 'error' | 'stopped'
  result?: ExecutionResult & {
    session_name: string
    session_name_updated: boolean
  }
  progress?: {
    task_stage?: string
    task_stage_label?: string
    latest_log?: ExecutionLog & { step_label: string } | null
    logs: Array<ExecutionLog & { step_label: string }>
    workflow_steps: Array<WorkflowStep & { module_label: string }>
    message: string
  }
  error?: string
}

export interface TemplateListResponse {
  templates: Template[]
}

export interface SkillListResponse {
  skills: Skill[]
}

// 请求参数类型
export interface ExecuteRequest {
  user_input: string
  focus_file?: string
}

export interface SaveTemplateRequest {
  task_description: string
  code: string
  file_info: Array<{ name: string; type: string; size: number }>
  output_files: Array<{ name: string; size: number }>
}
