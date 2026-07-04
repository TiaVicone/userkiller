import path from 'node:path'
import fs from 'node:fs/promises'
import { v4 as uuidv4 } from 'uuid'
import {
  ensureDirWithMcp,
  loadDeepSeekConfig,
  readJsonFile,
  TEMPLATES_DIR,
  SKILLS_DIR,
  writeJsonFileWithMcp,
} from '../fsUtils.js'
import type { SkillRecord, WorkspaceSnapshot, TaskUnderstanding } from '../types.js'

const SKILL_INDEX = path.join(TEMPLATES_DIR, 'skills.json')

/** Skill IDs that were previously shipped as defaults but no longer supported.
 *  They are filtered out on load so stale skills.json entries don't resurface. */
const RETIRED_SKILL_IDS = new Set(['pptx', 'mcp-builder', 'webapp-testing'])

export async function loadSkillContent(skillId: string): Promise<string | null> {
  const skillDir = path.join(SKILLS_DIR, skillId)
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  try {
    const content = await fs.readFile(skillMdPath, 'utf-8')
    return content.replace(/^---[\s\S]*?---\n/, '').trim()
  } catch {
    return null
  }
}

const DEFAULT_SKILLS: SkillRecord[] = [
  {
    id: 'spreadsheet-summary',
    name: '表格汇总技能',
    description: '适用于 Excel/CSV 汇总、统计、去重与结果表生成。',
    version: '1.0.0',
    tags: ['excel', 'csv', '汇总', '统计'],
    applicable_when: {
      intent_keywords: ['汇总', '统计', '表格', 'excel', 'xlsx'],
      file_types: ['xlsx', 'xls', 'csv'],
      preferred_file_kinds: ['spreadsheet', 'csv'],
    },
    input_requirements: {
      min_files: 1,
      required_file_types: ['xlsx', 'csv'],
      needs_structured_input: true,
    },
    execution_policy: {
      preferred_stages: ['inspect_files', 'analyze_structure', 'produce_outputs', 'verify_outputs'],
      recommended_tools: ['inspect_file', 'preview_spreadsheet', 'execute_python'],
      guidance_rules: ['优先识别表头与关键字段', '优先生成真实 Excel/CSV 交付物', '无法识别关键列时应明确说明阻塞点'],
      ask_user_when: ['缺少关键字段', '多个输入表结构冲突'],
    },
    deliverable_policy: {
      primary_output_type: 'xlsx',
      default_outputs: [
        { filename: 'result.xlsx', type: 'xlsx', purpose: '主要汇总交付物', required: true },
        { filename: 'final-report.md', type: 'md', purpose: '辅助说明', required: false },
      ],
      completion_criteria: ['必须生成主表格交付文件', '必须至少分析一个输入表格'],
    },
    examples: [
      { user_request: '把这个报名表汇总一下', expected_behavior: '先理解表结构，再生成新的 Excel 汇总文件' },
    ],
    usage_count: 0,
    success_count: 0,
    failure_count: 0,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 'structured-data-extract',
    name: '结构化数据提取技能',
    description: '适用于 JSON/CSV/表格中的结构化信息提取与导出。',
    version: '1.0.0',
    tags: ['json', '提取', '结构化'],
    applicable_when: {
      intent_keywords: ['提取', '导出', '结构化', 'json'],
      file_types: ['json', 'csv', 'xlsx', 'xls'],
      preferred_file_kinds: ['json', 'csv', 'spreadsheet'],
    },
    input_requirements: {
      min_files: 1,
      needs_structured_input: true,
    },
    execution_policy: {
      preferred_stages: ['inspect_files', 'analyze_structure', 'produce_outputs'],
      recommended_tools: ['inspect_file', 'read_file', 'write_json_result'],
      guidance_rules: ['优先提取可验证的结构化字段', '输出 JSON 时保持结构清晰'],
    },
    deliverable_policy: {
      primary_output_type: 'json',
      default_outputs: [
        { filename: 'result.json', type: 'json', purpose: '结构化结果', required: true },
      ],
      completion_criteria: ['必须生成 JSON 结果或明确说明无法提取原因'],
    },
    usage_count: 0,
    success_count: 0,
    failure_count: 0,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 'document-report',
    name: '文档总结与报告技能',
    description: '适用于 Markdown/TXT 等文本资料总结、整理与报告输出。',
    version: '1.0.0',
    tags: ['报告', '总结', 'markdown', '文档'],
    applicable_when: {
      intent_keywords: ['总结', '报告', '整理', '归纳', 'markdown'],
      file_types: ['md', 'txt'],
      preferred_file_kinds: ['document', 'text'],
    },
    input_requirements: {
      min_files: 1,
    },
    execution_policy: {
      preferred_stages: ['inspect_files', 'produce_outputs', 'verify_outputs'],
      recommended_tools: ['read_file', 'read_multiple_files', 'write_markdown_report'],
      guidance_rules: ['优先生成 markdown 报告', '如果信息不足，应在报告中明确限制'],
    },
    deliverable_policy: {
      primary_output_type: 'md',
      default_outputs: [
        { filename: 'final-report.md', type: 'md', purpose: '分析总结报告', required: true },
      ],
      completion_criteria: ['必须生成 markdown 报告'],
    },
    usage_count: 0,
    success_count: 0,
    failure_count: 0,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 'docx',
    name: 'Word Document Processing',
    description: 'Create, read, edit, and manipulate Word documents (.docx files). Use for professional documents with formatting, tables of contents, headings, page numbers, tracked changes, or converting content into polished Word documents.',
    version: '1.0.0',
    tags: ['word', 'docx', 'document', 'office'],
    applicable_when: {
      intent_keywords: ['word', 'docx', 'document', 'doc', 'memo', 'letter', 'report'],
      file_types: ['docx', 'doc'],
      preferred_file_kinds: ['document'],
    },
    input_requirements: { min_files: 0 },
    execution_policy: {
      preferred_stages: ['inspect_files', 'analyze_structure', 'produce_outputs'],
      recommended_tools: ['read_file', 'execute_python'],
      guidance_rules: ['Use SKILL.md for detailed guidance'],
    },
    deliverable_policy: {
      primary_output_type: 'docx',
      default_outputs: [{ filename: 'document.docx', type: 'docx', purpose: 'Word document', required: true }],
      completion_criteria: ['Generate .docx file or explain why not possible'],
    },
    usage_count: 0,
    success_count: 0,
    failure_count: 0,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 'xlsx',
    name: 'Excel Spreadsheet Processing',
    description: 'Open, read, edit, create, and manipulate Excel spreadsheets (.xlsx, .xlsm, .csv files). Use for adding columns, computing formulas, formatting, charting, cleaning messy data, or creating new spreadsheets.',
    version: '1.0.0',
    tags: ['excel', 'xlsx', 'spreadsheet', 'csv', 'office'],
    applicable_when: {
      intent_keywords: ['excel', 'xlsx', 'spreadsheet', 'csv', 'table'],
      file_types: ['xlsx', 'xls', 'xlsm', 'csv'],
      preferred_file_kinds: ['spreadsheet', 'csv'],
    },
    input_requirements: { min_files: 0 },
    execution_policy: {
      preferred_stages: ['inspect_files', 'analyze_structure', 'produce_outputs'],
      recommended_tools: ['preview_spreadsheet', 'execute_python'],
      guidance_rules: ['Use SKILL.md for detailed guidance'],
    },
    deliverable_policy: {
      primary_output_type: 'xlsx',
      default_outputs: [{ filename: 'spreadsheet.xlsx', type: 'xlsx', purpose: 'Excel spreadsheet', required: true }],
      completion_criteria: ['Generate spreadsheet file'],
    },
    usage_count: 0,
    success_count: 0,
    failure_count: 0,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 'pdf',
    name: 'PDF 处理技能',
    description: '读取 PDF 文本与表格、提取字段、合并/拆分/转换为其他格式。适用于 PDF 内容分析与转 Excel/文本任务。',
    version: '1.0.0',
    tags: ['pdf', 'document', '提取', '转换'],
    applicable_when: {
      intent_keywords: ['pdf', '提取', '转换', '合并', '拆分'],
      file_types: ['pdf'],
      preferred_file_kinds: ['pdf'],
    },
    input_requirements: { min_files: 1, required_file_types: ['pdf'] },
    execution_policy: {
      preferred_stages: ['inspect_files', 'analyze_structure', 'produce_outputs'],
      recommended_tools: ['inspect_file', 'read_file', 'execute_python'],
      guidance_rules: [
        '使用 pypdf 库读取 PDF 文本，pdfplumber 读取表格',
        '如需生成 PDF，使用 reportlab 库',
        '优先输出结构化结果（Excel/JSON/Markdown）而非重新生成 PDF',
      ],
    },
    deliverable_policy: {
      primary_output_type: 'md',
      default_outputs: [{ filename: 'pdf-extraction.md', type: 'md', purpose: 'PDF 内容提取结果', required: true }],
      completion_criteria: ['必须提取到实际内容并输出结果文件'],
    },
    usage_count: 0,
    success_count: 0,
    failure_count: 0,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
]

export interface SkillMatchResult {
  skill: SkillRecord
  score: number
  reasons: string[]
}

export async function listSkills(): Promise<SkillRecord[]> {
  await ensureDirWithMcp(TEMPLATES_DIR)
  const savedSkills = await readJsonFile<SkillRecord[]>(SKILL_INDEX, [])
  const merged = mergeSkills(savedSkills)
  return merged.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export async function getSkill(skillId: string): Promise<SkillRecord | null> {
  const skills = await listSkills()
  return skills.find(skill => skill.id === skillId) || null
}

export async function saveSkills(skills: SkillRecord[]) {
  const config = await loadDeepSeekConfig()
  await writeJsonFileWithMcp(SKILL_INDEX, skills, config)
}

export async function createSkill(input: Partial<SkillRecord> & { name: string; description?: string }) {
  const skills = await listSkills()
  const now = new Date().toISOString()
  const skill: SkillRecord = {
    id: input.id || uuidv4(),
    name: input.name,
    description: input.description || input.name,
    version: input.version || '1.0.0',
    tags: input.tags || [],
    applicable_when: input.applicable_when || {},
    input_requirements: input.input_requirements || {},
    execution_policy: input.execution_policy || {},
    deliverable_policy: input.deliverable_policy || {
      primary_output_type: 'txt',
      default_outputs: [{ filename: 'result.txt', type: 'txt', purpose: '默认文本结果', required: true }],
      completion_criteria: ['必须生成至少一个结果文件或说明原因'],
    },
    examples: input.examples || [],
    usage_count: input.usage_count || 0,
    success_count: input.success_count || 0,
    failure_count: input.failure_count || 0,
    created_at: input.created_at || now,
    updated_at: now,
    last_used: input.last_used,
  }
  const next = [...skills.filter(item => item.id !== skill.id), skill]
  await saveSkills(next)
  return skill
}

export async function deleteSkill(skillId: string) {
  const skills = await listSkills()
  await saveSkills(skills.filter(skill => skill.id !== skillId || isDefaultSkill(skill.id)))
}

export async function bumpSkillUsage(skillId: string, success?: boolean) {
  const skills = await listSkills()
  const now = new Date().toISOString()
  const next = skills.map(skill => {
    if (skill.id !== skillId) return skill
    return {
      ...skill,
      usage_count: skill.usage_count + 1,
      success_count: success === true ? skill.success_count + 1 : skill.success_count,
      failure_count: success === false ? skill.failure_count + 1 : skill.failure_count,
      last_used: now,
      updated_at: now,
    }
  })
  await saveSkills(next)
}

export async function updateSkillTags(skillId: string, tags: string[]) {
  const skills = await listSkills()
  let updatedSkill: SkillRecord | null = null
  const normalizedTags = [...new Set(tags.map(tag => String(tag).trim()).filter(Boolean))]
  const now = new Date().toISOString()

  const next = skills.map(skill => {
    if (skill.id !== skillId) return skill
    updatedSkill = { ...skill, tags: normalizedTags, updated_at: now }
    return updatedSkill
  })

  if (!updatedSkill) return null
  await saveSkills(next)
  return updatedSkill
}

export async function matchSkills(
  userInput: string,
  snapshot: WorkspaceSnapshot,
  understanding?: TaskUnderstanding,
): Promise<SkillMatchResult[]> {
  const skills = await listSkills()
  // 理解环节补全的关键词并入原始指令，模糊指令也能命中语义信号
  const understandingKeywords = (understanding?.intentKeywords || []).map(kw => kw.toLowerCase())
  const goalText = (understanding?.goal || '').toLowerCase()
  const normalizedInput = [userInput.toLowerCase(), goalText, understandingKeywords.join(' ')].join(' ')
  const fileNames = snapshot.workspaceFiles.map(file => file.name.toLowerCase())
  // 文件类型来自实际工作区文件 + 理解环节推断的类型
  const fileExtensions = [
    ...fileNames.map(name => name.split('.').pop() || ''),
    ...(understanding?.inferredFileTypes || []).map(ext => ext.toLowerCase()),
  ]

  return skills
    .map(skill => {
      let score = 0
      let keywordHits = 0
      let fileTypeHits = 0
      const reasons: string[] = []

      for (const keyword of skill.applicable_when.intent_keywords || []) {
        const lowerKeyword = keyword.toLowerCase()
        const inRawOrGoal = normalizedInput.includes(lowerKeyword)
        const inUnderstanding = understandingKeywords.includes(lowerKeyword)
        if (inRawOrGoal || inUnderstanding) {
          score += 3
          keywordHits += 1
          reasons.push(`命中关键词：${keyword}${inUnderstanding && !userInput.toLowerCase().includes(lowerKeyword) ? '（理解补全）' : ''}`)
        }
      }

      for (const ext of skill.applicable_when.file_types || []) {
        if (fileExtensions.includes(ext.toLowerCase())) {
          score += 2
          fileTypeHits += 1
          reasons.push(`命中文件类型：${ext}`)
        }
      }

      // Strong-signal bonus: both semantic (keyword) AND structural (file type) match
      if (keywordHits > 0 && fileTypeHits > 0) {
        score += 2
        reasons.push('意图与文件类型双命中')
      }

      // Requires strong signal to consider input_requirements match (avoids weak match)
      if (score >= 3 && (skill.input_requirements.min_files || 0) <= snapshot.workspaceFiles.length) {
        score += 1
        reasons.push('工作区文件数量满足技能要求')
      }

      if (score > 0) {
        score += Math.min(skill.usage_count, 5) * 0.1
      }

      return { skill, score, reasons }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

function mergeSkills(savedSkills: SkillRecord[]) {
  const map = new Map<string, SkillRecord>()
  for (const skill of DEFAULT_SKILLS) map.set(skill.id, skill)
  for (const skill of savedSkills) {
    if (RETIRED_SKILL_IDS.has(skill.id)) continue
    map.set(skill.id, skill)
  }
  return [...map.values()]
}

function isDefaultSkill(skillId: string) {
  return DEFAULT_SKILLS.some(skill => skill.id === skillId)
}
