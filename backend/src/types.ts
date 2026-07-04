export type Role = 'user' | 'assistant'

export type TaskStage =
  | 'understand'
  | 'inspect_files'
  | 'analyze_structure'
  | 'produce_outputs'
  | 'verify_outputs'
  | 'complete'

export interface ChatMessage {
  role: Role
  content: string
  timestamp: string
  loading?: boolean
  error?: boolean
  success?: boolean
  interrupted?: boolean
  workflow_steps?: WorkflowStep[]
  logs?: ExecutionLog[]
  generated_code?: string
  task_description?: string
  focus_file?: string
}

export interface SessionFileInfo {
  name: string
  path: string
  size: number
  modified_at: string
}

export interface WorkflowStep {
  module: string
  status: 'completed' | 'error' | 'running'
  output: string
  code?: string
}

export interface ExecutionLog {
  timestamp: string
  step: string
  status: 'info' | 'success' | 'error'
  content: string
}

export interface ToolCallRecord {
  turn: number
  phase?: 'decision' | 'execution'
  tool: ToolName
  input: Record<string, unknown>
  success: boolean
  outputSummary: string
  outputPreview?: string
  outputData?: unknown
  artifacts?: string[]
  error?: string
  createdAt: string
}

export interface AgentContextRecord {
  turn: number
  observation: string
  action: string
  result: string
  stage?: TaskStage
  createdAt: string
}

export interface AgentExecutionResult {
  success: boolean
  stopReason: 'end_turn' | 'max_turns' | 'stopped' | 'clarification_required'
  message: string
  workflowSteps: WorkflowStep[]
  logs: ExecutionLog[]
  generatedCode?: string
  taskDescription: string
  contextRecords: AgentContextRecord[]
  toolCalls: ToolCallRecord[]
  taskStage?: TaskStage
  deliverablePlan?: DeliverablePlan
  taskState?: TaskState
  clarificationRequest?: ClarificationRequest
  taskUnderstanding?: TaskUnderstanding
}

export interface DeliverablePlanItem {
  filename: string
  type: 'xlsx' | 'csv' | 'docx' | 'md' | 'json' | 'txt' | 'pdf' | 'pptx' | 'py'
  purpose: string
  required: boolean
  status?: 'planned' | 'generated' | 'missing'
}

export interface DeliverablePlan {
  primaryOutputType: DeliverablePlanItem['type']
  outputFiles: DeliverablePlanItem[]
  notes?: string[]
  selectedInputs?: string[]
}

export interface ClarificationRequest {
  question: string
  reason: string
  missingDetails: string[]
  options?: string[]
}

/**
 * 任务理解结果：读取用户原始指令 + 工作区文件后，由 LLM 将模糊指令补全为
 * 一个结构化、可执行的任务单，用于驱动技能匹配与后续执行决策。
 */
export interface TaskUnderstanding {
  /** 补全后的一句话任务目标，消除歧义，明确产出 */
  goal: string
  /** 归一化 / 推断出的意图关键词，用于技能匹配（含用户未显式说出的） */
  intentKeywords: string[]
  /** 主要涉及的文件类型（扩展名，小写，无点），来自实际文件或推断 */
  inferredFileTypes: string[]
  /** 模型认为本次应处理的目标文件名（来自工作区实际文件） */
  targetFiles: string[]
  /** 期望产出的交付物类型，如 xlsx / docx / md / json */
  expectedDeliverable?: DeliverablePlanItem['type']
  /** 拆解出的可执行步骤，供执行阶段参考 */
  actionPlan: string[]
  /** 仍然缺失、可能需要向用户澄清的信息 */
  missingInfo: string[]
  /** 0-1，模型对本次理解的置信度 */
  confidence: number
  /** 是否由 LLM 生成（false 表示降级到规则推断） */
  llmGenerated: boolean
}

export interface ClarificationPolicy {
  enabled: boolean
}

export interface ContextPackFile {
  name: string
  kind: 'spreadsheet' | 'document' | 'text' | 'data' | 'other' | 'pdf' | 'presentation'
  size: number
  priority: number
  reasons: string[]
  summary?: string
}

export interface ContextPack {
  userIntent: 'spreadsheet' | 'document' | 'data' | 'generic'
  recommendedStage: TaskStage
  candidateInputs: ContextPackFile[]
  pinnedFiles: string[]
  avoidedFiles: string[]
  summary: string
}

export interface TaskState {
  stage: TaskStage
  selectedSkillId?: string
  selectedSkillName?: string
  selectedInputs: string[]
  inspectedFiles: string[]
  producedOutputs: string[]
  blockers: string[]
  unsupportedFiles?: Array<{
    name: string
    reason: string
  }>
  explorationMode?: 'none' | 'documents' | 'generic'
  explorationSummary?: {
    sampleCount: number
    likelyDocumentTask?: 'vote-statistics' | 'document-summary' | 'generic'
    matchedSignals?: string[]
    sampleTargets?: string[]
  }
  pendingClarification?: ClarificationRequest
  understanding?: TaskUnderstanding
}

export interface SkillRecord {
  id: string
  name: string
  description: string
  version: string
  tags: string[]
  applicable_when: {
    intent_keywords?: string[]
    file_types?: string[]
    preferred_file_kinds?: Array<'spreadsheet' | 'csv' | 'json' | 'document' | 'text' | 'pdf' | 'presentation'>
  }
  input_requirements: {
    min_files?: number
    max_files?: number
    required_file_types?: string[]
    required_fields?: string[]
    needs_structured_input?: boolean
  }
  execution_policy: {
    preferred_stages?: TaskStage[]
    recommended_tools?: ToolName[]
    forbidden_tools?: ToolName[]
    guidance_rules?: string[]
    ask_user_when?: string[]
  }
  deliverable_policy: {
    primary_output_type: DeliverablePlanItem['type']
    default_outputs: DeliverablePlanItem[]
    completion_criteria: string[]
  }
  examples?: Array<{
    user_request: string
    expected_behavior: string
  }>
  usage_count: number
  success_count: number
  failure_count: number
  created_at: string
  updated_at: string
  last_used?: string
}

export interface SessionIndexEntry {
  id: string
  name: string
  created_at: string
  workspace_path: string
  output_path: string
  status: SessionRecord['status']
  taskStage?: TaskStage
  last_used?: string
}

export interface SessionRecord {
  id: string
  name: string
  created_at: string
  workspace_path: string
  output_path: string
  messages: ChatMessage[]
  status: 'idle' | 'executing' | 'completed' | 'error' | 'stopped' | 'awaiting_clarification'
  result?: AgentExecutionResult
  error?: string
  stopRequested: boolean
  contextRecords: AgentContextRecord[]
  toolCalls: ToolCallRecord[]
  taskStage?: TaskStage
  deliverablePlan?: DeliverablePlan
  taskState?: TaskState
  clarificationPolicy?: ClarificationPolicy
}

export interface QueryRequest {
  sessionId: string
  userInput: string
  maxTurns?: number
  focusFile?: string
  userId?: string
}

export interface WorkspaceFilePreview {
  name: string
  size: number
  modifiedAt: string
}

export interface WorkspaceSnapshot {
  workspaceFiles: WorkspaceFilePreview[]
  outputFiles: WorkspaceFilePreview[]
  summary: string
}

export type ToolResult = {
  summary: string
  data?: unknown
  createdFile?: string
  success?: boolean
  artifacts?: string[]
  error?: string
}

export type ToolName =
  | 'observe_workspace'
  | 'list_workspace_tree'
  | 'inspect_file'
  | 'read_file'
  | 'read_multiple_files'
  | 'preview_spreadsheet'
  | 'execute_python'
  | 'write_file'
  | 'write_markdown_report'
  | 'write_json_result'
  | 'copy_workspace_file_to_output'
  | 'list_mcp_tools'
  | 'call_mcp_tool'
  | 'end_turn'

export interface ToolDecision {
  tool: ToolName
  input: Record<string, unknown>
  reasoning: string
}

export interface DeepSeekConfig {
  apiKey: string
  baseUrl: string
  model: string
  maxTurns: number
  mcpServers?: MCPServerConfig[]
}

export interface MCPServerConfig {
  id: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  description?: string
}

export interface DeepSeekToolDefinition {
  name: ToolName
  description: string
  inputSchema: Record<string, unknown>
}

export interface DeepSeekToolDecision {
  reasoning: string
  tool: ToolName
  input: Record<string, unknown>
}

export interface TemplateRecord {
  id: string
  name: string
  description: string
  task_description: string
  created_at: string
  last_used?: string
  usage_count: number
  code: string
  file_info: Array<Record<string, unknown>>
  output_files: Array<Record<string, unknown>>
  tags: string[]
}
