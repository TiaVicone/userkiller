import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import {
  ensureDirWithMcp,
  loadDeepSeekConfig,
  readJsonFile,
  TEMPLATES_DIR,
  writeJsonFileWithMcp,
} from '../fsUtils.js'
import type { SkillRecord, TemplateRecord } from '../types.js'

const TEMPLATE_INDEX = path.join(TEMPLATES_DIR, 'templates.json')

export async function listTemplates(): Promise<TemplateRecord[]> {
  await ensureDirWithMcp(TEMPLATES_DIR)
  const templates = await readJsonFile<TemplateRecord[]>(TEMPLATE_INDEX, [])
  return templates.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function getTemplate(templateId: string): Promise<TemplateRecord | null> {
  const templates = await listTemplates()
  return templates.find(template => template.id === templateId) || null
}

export async function saveTemplates(templates: TemplateRecord[]) {
  const config = await loadDeepSeekConfig()
  await writeJsonFileWithMcp(TEMPLATE_INDEX, templates, config)
}

export async function createTemplate(input: {
  name: string
  taskDescription: string
  code: string
  fileInfo: Array<Record<string, unknown>>
  outputFiles: Array<Record<string, unknown>>
}) {
  const templates = await listTemplates()
  const now = new Date().toISOString()
  const template: TemplateRecord = {
    id: uuidv4(),
    name: input.name || input.taskDescription || '未命名模板',
    description: input.taskDescription || input.name || '暂无描述',
    task_description: input.taskDescription || input.name || '暂无描述',
    created_at: now,
    last_used: now,
    usage_count: 0,
    code: input.code || '',
    file_info: input.fileInfo || [],
    output_files: input.outputFiles || [],
    tags: inferTags(input.taskDescription, input.fileInfo),
  }
  templates.push(template)
  await saveTemplates(templates)
  return template
}

export async function deleteTemplate(templateId: string) {
  const templates = await listTemplates()
  await saveTemplates(templates.filter(template => template.id !== templateId))
}

export async function bumpTemplateUsage(templateId: string) {
  const templates = await listTemplates()
  const now = new Date().toISOString()
  const next = templates.map(template =>
    template.id === templateId
      ? { ...template, usage_count: (template.usage_count || 0) + 1, last_used: now }
      : template,
  )
  await saveTemplates(next)
}

export async function updateTemplateTags(templateId: string, tags: string[]) {
  const templates = await listTemplates()
  let updatedTemplate: TemplateRecord | null = null
  const normalizedTags = [...new Set(tags.map(tag => String(tag).trim()).filter(Boolean))]

  const next = templates.map(template => {
    if (template.id !== templateId) return template
    updatedTemplate = { ...template, tags: normalizedTags }
    return updatedTemplate
  })

  if (!updatedTemplate) return null
  await saveTemplates(next)
  return updatedTemplate
}

export async function findSimilarTemplates(userInput: string): Promise<TemplateRecord[]> {
  const templates = await listTemplates()
  const keywords = userInput.toLowerCase().split(/\s+/).filter(Boolean)
  return templates
    .map(template => {
      const haystack = `${template.name} ${template.description} ${template.task_description} ${template.tags.join(' ')}`.toLowerCase()
      const score = keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0)
      return { template, score }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.template.usage_count - a.template.usage_count)
    .slice(0, 5)
    .map(item => item.template)
}

function inferTags(taskDescription: string, fileInfo: Array<Record<string, unknown>>) {
  const tags = new Set<string>()
  const text = (taskDescription || '').toLowerCase()
  if (text.includes('表格') || text.includes('excel')) tags.add('表格填写')
  if (text.includes('汇总') || text.includes('统计') || text.includes('分析')) tags.add('数据分析')
  if (text.includes('生成') || text.includes('创建')) tags.add('文档生成')
  if (text.includes('合并') || text.includes('整理')) tags.add('数据合并')
  if (text.includes('批量')) tags.add('批量处理')

  fileInfo.forEach(file => {
    const filename = String(file.filename || file.name || '')
    const ext = filename.split('.').pop()?.toLowerCase()
    if (ext === 'csv') tags.add('CSV')
    if (ext === 'pdf') tags.add('PDF')
    if (ext === 'docx' || ext === 'doc') tags.add('Word')
    if (ext === 'xlsx' || ext === 'xls') tags.add('Excel')
  })

  return [...tags]
}
