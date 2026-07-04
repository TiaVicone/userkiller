import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import type { DeliverablePlan, SessionRecord, WorkspaceSnapshot } from '../types.js'
import { extractWordText } from './word/index.js'

export interface OutputQualityIssue {
  file: string
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface OutputQualityReport {
  passed: boolean
  issues: OutputQualityIssue[]
  checkedFiles: string[]
  summary: string
}

const AUXILIARY_OUTPUTS = new Set(['task-plan.md', 'final-report.md'])

export async function validateOutputQuality(params: {
  session: SessionRecord
  snapshot: WorkspaceSnapshot
  plan?: DeliverablePlan
  userInput?: string
}): Promise<OutputQualityReport> {
  const outputNames = new Set(params.snapshot.outputFiles.map(file => file.name))
  const planned = (params.plan?.outputFiles || []).filter(item => item.required && outputNames.has(item.filename))
  const fallback = params.snapshot.outputFiles
    .filter(file => !AUXILIARY_OUTPUTS.has(file.name))
    .map(file => ({ filename: file.name, type: inferOutputType(file.name) }))

  const targets = (planned.length ? planned : fallback)
    .map(item => ({ filename: item.filename, type: item.type }))
    .filter((item, index, arr) => arr.findIndex(other => other.filename === item.filename) === index)

  const issues: OutputQualityIssue[] = []
  const checkedFiles: string[] = []

  for (const target of targets) {
    checkedFiles.push(target.filename)
    const fullPath = path.join(params.session.output_path, path.basename(target.filename))
    const stat = await fs.stat(fullPath).catch(() => null)
    if (!stat || !stat.isFile()) {
      issues.push({ file: target.filename, severity: 'error', code: 'missing_output', message: '计划交付文件不存在' })
      continue
    }
    if (stat.size === 0) {
      issues.push({ file: target.filename, severity: 'error', code: 'empty_output', message: '输出文件为空' })
      continue
    }

    if (target.type === 'docx' || target.filename.toLowerCase().endsWith('.docx')) {
      issues.push(...await validateDocxOutput(fullPath, target.filename, params.userInput || ''))
    }

    if ((target.type === 'txt' || target.type === 'md' || target.filename.toLowerCase().match(/\.(txt|md|json|csv)$/)) && stat.size > 0) {
      issues.push(...await validateTextLikeOutput(fullPath, target.filename))
    }
  }

  const blocking = issues.filter(issue => issue.severity === 'error')
  return {
    passed: blocking.length === 0,
    issues,
    checkedFiles,
    summary: issues.length
      ? `质量检测发现 ${blocking.length} 个错误、${issues.length - blocking.length} 个警告`
      : `质量检测通过，已检查 ${checkedFiles.length} 个输出文件`,
  }
}

async function validateDocxOutput(fullPath: string, filename: string, userInput: string): Promise<OutputQualityIssue[]> {
  const issues: OutputQualityIssue[] = []
  const buffer = await fs.readFile(fullPath)

  if (buffer.subarray(0, 2).toString('utf8') !== 'PK') {
    return [{ file: filename, severity: 'error', code: 'invalid_docx_zip', message: 'docx 文件不是有效 ZIP/OOXML 格式，Word 打开时可能显示乱码或损坏' }]
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return [{ file: filename, severity: 'error', code: 'invalid_docx_zip', message: 'docx 文件无法解析为 ZIP/OOXML，疑似损坏或乱码' }]
  }

  if (!zip.file('word/document.xml')) {
    issues.push({ file: filename, severity: 'error', code: 'missing_document_xml', message: 'docx 缺少 word/document.xml，疑似不是有效 Word 文档' })
    return issues
  }

  let text = ''
  try {
    const extracted = await extractWordText(fullPath)
    text = extracted.text || ''
  } catch (error) {
    issues.push({ file: filename, severity: 'error', code: 'docx_extract_failed', message: `无法提取 Word 文本：${error instanceof Error ? error.message : '未知错误'}` })
    return issues
  }

  const trimmed = text.trim()
  if (trimmed.length < 10) {
    issues.push({ file: filename, severity: 'warning', code: 'docx_too_little_text', message: 'Word 文档可解析，但可提取文本过少，请确认是否符合预期' })
  }

  const garbledScore = calculateGarbledScore(trimmed)
  if (garbledScore >= 0.18) {
    issues.push({ file: filename, severity: 'error', code: 'garbled_text_detected', message: `检测到疑似乱码文本（乱码评分 ${(garbledScore * 100).toFixed(1)}%）` })
  }

  if (/删除|去掉|去除|移除/.test(userInput) && /答案|解析/.test(userInput)) {
    const answerLikeCount = countAnswerLikeSignals(trimmed)
    if (answerLikeCount > 0) {
      issues.push({ file: filename, severity: 'warning', code: 'answer_signals_remaining', message: `输出文档仍检测到 ${answerLikeCount} 处疑似答案/解析标记，请复核是否删除干净` })
    }
  }

  return issues
}

async function validateTextLikeOutput(fullPath: string, filename: string): Promise<OutputQualityIssue[]> {
  const content = await fs.readFile(fullPath, 'utf8').catch(() => '')
  if (!content.trim()) {
    return [{ file: filename, severity: 'warning', code: 'empty_text_output', message: '文本类输出为空或无法按 UTF-8 读取' }]
  }
  const score = calculateGarbledScore(content)
  if (score >= 0.18) {
    return [{ file: filename, severity: 'error', code: 'garbled_text_detected', message: `文本输出疑似乱码（乱码评分 ${(score * 100).toFixed(1)}%）` }]
  }
  return []
}

function inferOutputType(filename: string): DeliverablePlan['primaryOutputType'] {
  const ext = filename.split('.').pop()?.toLowerCase() || 'txt'
  if (['xlsx', 'csv', 'docx', 'md', 'json', 'txt', 'pdf', 'pptx', 'py'].includes(ext)) {
    return ext as DeliverablePlan['primaryOutputType']
  }
  return 'txt'
}

function calculateGarbledScore(text: string) {
  if (!text) return 0
  const sample = text.slice(0, 6000)
  const suspiciousMatches = sample.match(/[�\u0000-\u0008\u000B\u000C\u000E-\u001F]|(?:[ÃÂ][\u0080-\u00BF])|(?:\?{3,})/g) || []
  const cjkCount = (sample.match(/[\u4e00-\u9fff]/g) || []).length
  const latinCount = (sample.match(/[A-Za-z]/g) || []).length
  const visibleCount = Math.max(1, sample.replace(/\s/g, '').length)
  const suspiciousRatio = suspiciousMatches.length / visibleCount

  // 中文办公文档中，如果几乎没有中英文可读字符且符号/控制字符很多，通常说明损坏或乱码。
  const readableRatio = (cjkCount + latinCount) / visibleCount
  return suspiciousRatio + (readableRatio < 0.08 && visibleCount > 80 ? 0.12 : 0)
}

function countAnswerLikeSignals(text: string) {
  const patterns = [
    /答案[:：]\s*[A-D对错√×]/g,
    /正确答案[:：]/g,
    /参考答案[:：]/g,
    /解析[:：]/g,
    /【答案】/g,
  ]
  return patterns.reduce((sum, pattern) => sum + (text.match(pattern) || []).length, 0)
}
