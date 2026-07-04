import OpenAI from 'openai'
import type {
  AgentContextRecord,
  ChatMessage,
  ClarificationPolicy,
  ContextPack,
  DeepSeekConfig,
  DeepSeekToolDecision,
  DeepSeekToolDefinition,
  DeliverablePlan,
  SkillRecord,
  TaskStage,
  TaskState,
  TaskUnderstanding,
  ToolCallRecord,
  WorkspaceSnapshot,
} from '../types.js'
import { logTokenUsage } from './tokenUsageService.js'

const SUPPORTED_MCP_SERVER_IDS = ['filesystem'] as const

const RESPONSE_FORMAT = {
  type: 'json_object',
} as const

function normalizeMcpServerId(serverId: string, allowedServerIds: string[]) {
  const normalized = serverId.trim().toLowerCase()
  if (!normalized) return allowedServerIds[0] || ''
  if (allowedServerIds.includes(normalized)) return normalized
  if (['spreadsheet', 'excel', 'office', 'table', 'tables'].includes(normalized)) {
    return allowedServerIds.includes('filesystem') ? 'filesystem' : (allowedServerIds[0] || normalized)
  }
  return normalized
}

export async function requestToolDecision(params: {
  config: DeepSeekConfig
  userInput: string
  turn: number
  maxTurns: number
  currentStage: TaskStage
  snapshot: WorkspaceSnapshot
  contextPack?: ContextPack
  contextRecords: AgentContextRecord[]
  toolCalls: ToolCallRecord[]
  messages: ChatMessage[]
  deliverablePlan?: DeliverablePlan
  selectedSkill?: SkillRecord
  skillContent?: string
  taskState?: TaskState
  clarificationPolicy?: ClarificationPolicy
  tools: DeepSeekToolDefinition[]
  sessionId?: string
  userId?: string
  understanding?: TaskUnderstanding
}) {
  const { config, userInput, turn, maxTurns, currentStage, snapshot, contextPack, contextRecords, toolCalls, messages, deliverablePlan, selectedSkill, taskState, clarificationPolicy, tools, understanding } = params
  const skillContent = params.skillContent
  const allowedServerIds = (config.mcpServers || []).map(server => server.id)
  const client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  })

  const systemPrompt = [
    '你是 AI 自动化办公助手的后端执行代理。',
    '你的职责是帮助用户完成办公自动化任务，而不是闲聊。',
    '你服务的对象是没有编程能力的大众，因此要主动澄清模糊需求、理解文件结构、优先生成可交付结果。',
    '核心原则：不修改用户原始文件；所有新产物写入 output。',
    '你每一轮必须只返回一个 JSON 工具决策对象，不要输出 markdown，不要输出解释性前后缀。',
    '',
    '## 执行策略',
    '优先顺序：理解任务 -> 观察文件 -> 理解文件结构 -> 生成结果文件 -> 校验交付 -> 结束。',
    '如果工作区信息不足，优先 observe_workspace、list_workspace_tree、inspect_file、preview_spreadsheet。',
    '',
    '## 避免循环（极其重要）',
    '检查 recentToolCalls，不要对同一个文件重复执行相同的工具。',
    '如果上一轮工具执行失败（success=false），立即分析失败原因，绝不要用相同工具重试，必须换一种方式。',
    '如果已经 inspect/read/preview 过某文件，直接利用已有信息，不要再读取。',
    '如果你连续 2 轮以上调用了同一个工具且目标相同，你正在陷入循环——必须立即切换策略。',
    '对于 Word 修改任务，优先使用当前 availableTools 中存在的工具；不要调用未列出的历史工具名。',
    '对于 Excel 修改任务，如果已知表结构，应直接使用 execute_python 一步完成，不要反复预览。',
    `当前轮次 ${turn}/${maxTurns}，如果已过半且主交付物未生成，优先跳到 produce_outputs 阶段。`,
    '',
    '## Word 文档处理',
    '可先 inspect_file 理解整体情况；需要精细阅读时用 read_file 配合 blockIds、blockType、offset、limit 做块级精读。',
    '修改 Word 时使用 execute_python 配合 python-docx 库处理。如果匹配了 docx skill，按照其 SKILL.md 指导执行。',
    '',
    '## 表格处理',
    '优先使用 preview_spreadsheet 理解表结构，然后用 execute_python 生成结果文件。',
    '对于表格数据的修改操作（删除列、修改值、筛选行、合并、排序等），必须使用 execute_python 直接执行，不要反复预览。',
    '对于行式流水数据（每行=一条事件记录）的透视汇总任务，preview 一次了解结构后，直接用 execute_python 生成结果，不要反复预览。',
    '',
    '## Python 执行（关键能力）',
    '当你需要对 Excel/CSV/PDF 进行任何修改或提取操作（如删列、改值、筛选、排序、合并、提取 PDF 文本/表格）时，使用 execute_python。',
    '它会生成临时 Python 脚本并执行，执行后自动删除临时文件。',
    '脚本运行在独立沙箱环境中，已预装以下库，可以直接 import 使用：',
    '  pandas（读写 xlsx/csv）、openpyxl（读写 xlsx）、xlrd（读取旧版 .xls）、',
    '  python-docx（读写 docx）、Pillow（图片处理）、reportlab（生成 PDF）、',
    '  pypdf（读取 PDF 文本/元数据）、pdfplumber（提取 PDF 表格）、',
    '  chardet（编码检测）、python-dateutil（日期处理）',
    '标准库可用：os、sys、re、json、csv、datetime、shutil、pathlib、io、xml、struct、zipfile、copy、math、collections、itertools、base64、hashlib、uuid、codecs、unicodedata',
    '禁止使用：subprocess、socket、requests、urllib 等网络相关模块',
    '',
    '## PDF 处理',
    '不能用 read_file 直接读取 PDF（二进制格式），必须用 execute_python + pypdf 或 pdfplumber。',
    '文本 PDF：pypdf.PdfReader 提取 text；表格 PDF：pdfplumber.open + page.extract_tables()。',
    '扫描版 PDF 目前无 OCR 能力，需明确告知用户。',
    'workspace 路径通过 WORKSPACE_PATH 和 OUTPUT_PATH 环境变量传入，直接用 os.environ["WORKSPACE_PATH"] 读取。',
    '处理 .xls 文件必须用 xlrd：pd.read_excel(path, engine="xlrd")。处理 .xlsx 用 openpyxl 或 pandas 默认引擎。',
    '简单任务一步到位，不要分多步。',
    '',
    '## 交付原则',
    '如果用户需求指向真实文件交付，优先产出与任务匹配的结果文件类型，而不是计划或总结。',
    '如果存在 deliverablePlan，请优先满足其中 required=true 的主交付物，再考虑辅助报告。',
    '如果存在 selectedSkill，请优先遵守该技能的 recommended_tools、guidance_rules 与 completion_criteria。',
    ...(skillContent ? [
      '',
      '## 已匹配技能详细指导（SKILL.md）',
      `当前任务已匹配技能「${selectedSkill?.name || ''}」，以下为该技能的完整执行指导，请严格按照其流程和方法执行：`,
      '',
      skillContent.slice(0, 8000),
    ] : []),
    '',
    ...(understanding ? [
      '',
      '## 任务理解（已由理解环节补全）',
      '在你决策前，系统已结合用户原始指令与工作区文件，将模糊需求补全为结构化任务单。请以此为准把握任务目标，不要重新猜测意图：',
      `- 明确目标：${understanding.goal}`,
      ...(understanding.targetFiles.length ? [`- 目标文件：${understanding.targetFiles.join('、')}`] : []),
      ...(understanding.expectedDeliverable ? [`- 期望交付物类型：${understanding.expectedDeliverable}`] : []),
      ...(understanding.actionPlan.length ? ['- 建议执行步骤：', ...understanding.actionPlan.map((step, index) => `  ${index + 1}. ${step}`)] : []),
      ...(understanding.missingInfo.length ? [`- 仍缺失的信息：${understanding.missingInfo.join('；')}（如确属关键且 clarificationPolicy.enabled，可 end_turn 澄清）`] : []),
    ] : []),
    '',
    '## 澄清策略',
    '如果 clarificationPolicy.enabled=true 且你发现缺少关键文件、关键字段、目标不明确，可以优先通过 end_turn 返回一个明确的澄清问题给用户，而不是盲目继续。',
    '',
    '## 输出约束',
    'write_file、write_markdown_report、write_json_result 只能写到 output 目录下。',
    'copy_workspace_file_to_output 用于保留中间产物或复制结果文件。',
    '当用户明确要调用外部 MCP 能力时，先使用 list_mcp_tools 查看可用工具，再使用 call_mcp_tool。',
    `当前只允许使用这些 MCP 服务 id：${SUPPORTED_MCP_SERVER_IDS.join('、')}。不要臆造未配置服务。`,
    '',
    '## 结束条件',
    '只有在已经形成可交付结果，或者明确无法继续且需要向用户说明时，才允许 end_turn。',
    `当前任务阶段：${currentStage}。请让决策与阶段匹配。`,
    '',
    '## end_turn 的 finalAnswer 写法（重要）',
    'finalAnswer 是展示给用户的完成总结，必须像真人助手一样用自然语言描述。',
    '不要写"任务完成"、"已处理"这类空话，要具体说明：做了什么操作、生成了哪些文件（写出文件名）、结果是什么。',
    '示例好的写法："已删除《消防题库》中全部 143 处答案，生成 output/消防题库（无答案）.docx，共保留 287 道题目正文，可直接下载使用。"',
    '示例差的写法："任务已完成。" / "已生成文件。" / "处理成功。"',
    `tool 必须严格是 availableTools 中列出的工具之一：${tools.map(tool => tool.name).join('、')}。`,
    '返回格式必须是：{"reasoning":"...","tool":"...","input":{}}。',
  ].join('\n')

  const inspectedFiles = [...new Set(toolCalls.filter(c => c.phase === 'execution' && ['inspect_file', 'read_file', 'preview_spreadsheet'].includes(c.tool)).map(c => String(c.input.target || '')))]
  const producedArtifacts = [...new Set(toolCalls.flatMap(c => c.artifacts || []))]
  const failedTools = toolCalls.filter(c => c.phase === 'execution' && c.success === false).map(c => ({ tool: c.tool, target: c.input.target, error: c.error }))

  const userPrompt = JSON.stringify(
    {
      currentTurn: turn,
      maxTurns,
      currentStage,
      userInput,
      taskUnderstanding: understanding ? {
        goal: understanding.goal,
        targetFiles: understanding.targetFiles,
        expectedDeliverable: understanding.expectedDeliverable,
        actionPlan: understanding.actionPlan,
        missingInfo: understanding.missingInfo,
      } : undefined,
      deliverablePlan,
      selectedSkill: selectedSkill ? { id: selectedSkill.id, name: selectedSkill.name, guidance_rules: selectedSkill.execution_policy.guidance_rules, completion_criteria: selectedSkill.deliverable_policy.completion_criteria } : undefined,
      taskState,
      clarificationPolicy,
      progressSummary: {
        inspectedFiles,
        producedArtifacts,
        failedTools: failedTools.slice(-3),
        turnsRemaining: maxTurns - turn,
        hasMainDeliverable: producedArtifacts.some(a => deliverablePlan?.outputFiles.some(f => f.filename === a && f.required)),
      },
      conversationHistory: messages.slice(-8).map(message => ({
        role: message.role,
        content: message.content.slice(0, 500),
      })),
      workspaceSnapshot: snapshot,
      contextPack: contextPack ? { userIntent: contextPack.userIntent, pinnedFiles: contextPack.pinnedFiles, summary: contextPack.summary } : undefined,
      priorContext: contextRecords.slice(-6).map(r => ({ turn: r.turn, action: r.action, result: r.result.slice(0, 300) })),
      recentToolCalls: toolCalls.slice(-8).map(call => ({
        turn: call.turn,
        tool: call.tool,
        input: call.input,
        success: call.success,
        outputSummary: call.outputSummary.slice(0, 200),
        outputData: call.outputPreview ? call.outputPreview.slice(0, 2000) : undefined,
        artifacts: call.artifacts,
        error: call.error,
      })),
      availableTools: tools,
      requirements: [
        '优先围绕文件与结果产物开展动作',
        '尽量产出真实可交付文件，而不仅是总结',
        '不要重复读取已检查过的文件',
        '如果已过半程且主交付物未生成，跳到生产阶段',
        '完成时必须调用 end_turn',
      ],
    },
    null,
    2,
  )

  const completion = await client.chat.completions.create({
    model: config.model,
    temperature: 0.2,
    response_format: RESPONSE_FORMAT,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  if (params.sessionId && completion.usage) {
    await logTokenUsage({
      sessionId: params.sessionId,
      userId: params.userId,
      model: config.model,
      promptTokens: completion.usage.prompt_tokens || 0,
      completionTokens: completion.usage.completion_tokens || 0,
      totalTokens: completion.usage.total_tokens || 0,
      turn: params.turn,
      purpose: 'tool_decision',
    })
  }

  const content = completion.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('DeepSeek 未返回有效内容')
  }

  const parsed = parseDecisionContent(content)
  if ((parsed.tool === 'list_mcp_tools' || parsed.tool === 'call_mcp_tool') && typeof parsed.input?.serverId === 'string') {
    parsed.input.serverId = normalizeMcpServerId(parsed.input.serverId, allowedServerIds)
  }
  validateDecision(parsed, tools)
  return parsed
}

function parseDecisionContent(content: string): DeepSeekToolDecision {
  try {
    return JSON.parse(content) as DeepSeekToolDecision
  } catch {
    const matched = content.match(/\{[\s\S]*\}/)
    if (!matched) {
      throw new Error(`DeepSeek 返回内容不是合法 JSON：${content.slice(0, 300)}`)
    }
    return JSON.parse(matched[0]) as DeepSeekToolDecision
  }
}

function validateDecision(decision: DeepSeekToolDecision, tools: DeepSeekToolDefinition[]) {
  if (!decision || typeof decision !== 'object') {
    throw new Error('DeepSeek 工具决策为空')
  }

  const allowedTools = new Set(tools.map(tool => tool.name))
  if (!allowedTools.has(decision.tool)) {
    throw new Error(`DeepSeek 返回了当前未注册的工具：${String(decision.tool)}`)
  }

  if (!decision.input || typeof decision.input !== 'object') {
    throw new Error('DeepSeek 工具决策缺少 input 对象')
  }

  if (decision.tool === 'end_turn' && typeof decision.input.finalAnswer !== 'string') {
    decision.input.finalAnswer = '任务处理完成，请查看 output 目录中的结果文件。'
  }
}

export async function generateSessionName(config: DeepSeekConfig, userInput: string): Promise<string> {
  const client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  })

  const systemPrompt = [
    '你是会话命名助手。你的任务是将用户的指令提炼成简洁的 5-10 个字的会话标题。',
    '',
    '规则：',
    '1. 提取核心动作和对象，去掉冗余词汇',
    '2. 优先保留文件名、关键操作词',
    '3. 长度严格控制在 5-10 个字（中文字符）',
    '4. 不要添加引号、标点符号',
    '5. 直接返回标题文本，不要解释',
    '',
    '示例：',
    '输入：请帮我把这个 Excel 表格的最后一列删掉',
    '输出：Excel删除列',
    '',
    '输入：我想分析一下 user.ts 文件中的代码逻辑，看看有没有性能问题',
    '输出：user.ts性能分析',
    '',
    '输入：生成一份包含所有用户信息的汇总报告',
    '输出：用户信息汇总',
  ].join('\n')

  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      temperature: 0.3,
      max_tokens: 50,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput },
      ],
    })

    const name = completion.choices?.[0]?.message?.content?.trim() || ''
    
    if (!name || name.length > 30) {
      return ''
    }
    
    const cleaned = name
      .replace(/^["'「『]|["'」』]$/g, '')
      .replace(/[：:，,。！？!?.、]/g, '')
      .trim()
    
    return cleaned.slice(0, 10)
  } catch (error) {
    console.error('AI 生成会话名称失败:', error)
    return ''
  }
}

const UNDERSTANDING_SYSTEM_PROMPT = [
  '你是办公自动化任务的“需求理解”专家。你服务的是没有编程能力的普通用户，他们的指令经常模糊、口语化、不提文件类型。',
  '你的职责：结合【用户原始指令】和【当前工作区文件清单】，把模糊需求补全为一个结构化、明确、可执行的任务单。',
  '',
  '关键原则：',
  '1. 用户没说文件类型时，从工作区文件推断（例如工作区只有 .docx，用户说“帮我弄一下”，就应理解为 Word 文档任务）。',
  '2. intentKeywords 要包含用户显式说的词，也要补全同义/上位意图词（如“汇总/统计/合并/提取/填写/转换/去除/生成”以及涉及的文件类别词 word/excel/pdf 等），以便后续正确匹配技能。',
  '3. targetFiles 只能从提供的工作区文件清单里选，不能臆造文件名。',
  '4. goal 要用一句话讲清“对哪个文件、做什么、产出什么”。',
  '5. actionPlan 是有序、可执行的粗粒度步骤（3-6 步）。',
  '6. 如果关键信息确实缺失（如未上传文件、目标不明），写入 missingInfo，并降低 confidence。',
  '',
  '只返回一个 JSON 对象，不要 markdown，不要多余解释。字段：',
  '{',
  '  "goal": string,',
  '  "intentKeywords": string[],',
  '  "inferredFileTypes": string[],   // 小写扩展名，无点，如 ["docx"]',
  '  "targetFiles": string[],         // 必须来自工作区清单',
  '  "expectedDeliverable": string,   // xlsx|csv|docx|md|json|txt|pdf 之一，或空串',
  '  "actionPlan": string[],',
  '  "missingInfo": string[],',
  '  "confidence": number             // 0~1',
  '}',
].join('\n')

const DELIVERABLE_TYPES = new Set(['xlsx', 'csv', 'docx', 'md', 'json', 'txt', 'pdf', 'pptx', 'py'])

export async function understandTask(params: {
  config: DeepSeekConfig
  userInput: string
  snapshot: WorkspaceSnapshot
  conversationHistory?: ChatMessage[]
  sessionId?: string
  userId?: string
}): Promise<TaskUnderstanding> {
  const { config, userInput, snapshot } = params
  const fallback = buildFallbackUnderstanding(userInput, snapshot)

  const client = new OpenAI({ baseURL: config.baseUrl, apiKey: config.apiKey })

  const workspaceFiles = snapshot.workspaceFiles.map(file => ({
    name: file.name,
    ext: (file.name.split('.').pop() || '').toLowerCase(),
    size: file.size,
  }))

  const userPrompt = JSON.stringify({
    userInput,
    workspaceFiles,
    recentConversation: (params.conversationHistory || []).slice(-4).map(message => ({
      role: message.role,
      content: String(message.content || '').slice(0, 300),
    })),
  }, null, 2)

  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      temperature: 0.2,
      max_tokens: 900,
      response_format: RESPONSE_FORMAT,
      messages: [
        { role: 'system', content: UNDERSTANDING_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    })

    if (params.sessionId && completion.usage) {
      await logTokenUsage({
        sessionId: params.sessionId,
        userId: params.userId,
        model: config.model,
        promptTokens: completion.usage.prompt_tokens || 0,
        completionTokens: completion.usage.completion_tokens || 0,
        totalTokens: completion.usage.total_tokens || 0,
        turn: 0,
        purpose: 'task_understanding',
      })
    }

    const content = completion.choices?.[0]?.message?.content
    if (!content) return fallback

    return normalizeUnderstanding(JSON.parse(content), userInput, snapshot)
  } catch (error) {
    console.error('任务理解调用失败，降级到规则推断:', error)
    return fallback
  }
}

function normalizeUnderstanding(raw: any, userInput: string, snapshot: WorkspaceSnapshot): TaskUnderstanding {
  const validFileNames = new Set(snapshot.workspaceFiles.map(file => file.name))
  const toStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : []

  const targetFiles = toStringArray(raw?.targetFiles).filter(name => validFileNames.has(name))
  const intentKeywords = [...new Set(toStringArray(raw?.intentKeywords).map(kw => kw.toLowerCase()))]
  const inferredFileTypes = [...new Set(toStringArray(raw?.inferredFileTypes).map(ext => ext.replace(/^\./, '').toLowerCase()))]
  const expectedRaw = String(raw?.expectedDeliverable || '').replace(/^\./, '').toLowerCase()
  const expectedDeliverable = DELIVERABLE_TYPES.has(expectedRaw) ? (expectedRaw as TaskUnderstanding['expectedDeliverable']) : undefined
  const confidence = typeof raw?.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.5

  return {
    goal: String(raw?.goal || userInput).slice(0, 500),
    intentKeywords,
    inferredFileTypes,
    targetFiles,
    expectedDeliverable,
    actionPlan: toStringArray(raw?.actionPlan).slice(0, 8),
    missingInfo: toStringArray(raw?.missingInfo).slice(0, 6),
    confidence,
    llmGenerated: true,
  }
}

function buildFallbackUnderstanding(userInput: string, snapshot: WorkspaceSnapshot): TaskUnderstanding {
  const normalized = userInput.toLowerCase()
  const fileExts = [...new Set(snapshot.workspaceFiles.map(file => (file.name.split('.').pop() || '').toLowerCase()).filter(Boolean))]

  // 从原始指令直接抽取常见办公意图词，缺失时用工作区文件类型补齐
  const KEYWORD_POOL = ['汇总', '统计', '合并', '提取', '填写', '转换', '去除', '删除', '生成', '整理', '总结', '分析', 'word', 'excel', 'pdf', 'csv', 'json']
  const intentKeywords = KEYWORD_POOL.filter(kw => normalized.includes(kw.toLowerCase()))
  for (const ext of fileExts) {
    if (ext === 'docx' || ext === 'doc') intentKeywords.push('word', 'docx')
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') intentKeywords.push('excel', 'xlsx')
    if (ext === 'pdf') intentKeywords.push('pdf')
  }

  return {
    goal: userInput,
    intentKeywords: [...new Set(intentKeywords.map(kw => kw.toLowerCase()))],
    inferredFileTypes: fileExts,
    targetFiles: snapshot.workspaceFiles.map(file => file.name).slice(0, 5),
    expectedDeliverable: undefined,
    actionPlan: [],
    missingInfo: snapshot.workspaceFiles.length === 0 ? ['工作区暂无文件，需用户上传待处理文件'] : [],
    confidence: 0.3,
    llmGenerated: false,
  }
}
