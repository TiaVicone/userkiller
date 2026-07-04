import fs from 'node:fs/promises'
import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import path from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import type { WordBlock, WordDocumentStructure, ParagraphNode, TableNode } from '../types.js'
import { normalizeWordCell } from './utils.js'

const execFile = promisify(execFileCallback)
const MARKITDOWN_PYTHON = process.env.MARKITDOWN_PYTHON || path.join(process.env.HOME || '', '.venvs', 'docx-mcp-global', 'bin', 'python')

export async function extractWordStructure(filePath: string): Promise<WordDocumentStructure> {
  const [textExtraction, tables, paragraphs] = await Promise.all([
    extractWordText(filePath),
    extractWordTables(filePath),
    extractWordParagraphsRaw(filePath),
  ])

  const blocks: WordBlock[] = []
  let order = 0

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const normalized = normalizeWordCell(paragraph)
    if (!normalized) return
    blocks.push({
      id: `p-${paragraphIndex + 1}`,
      type: 'paragraph',
      order: order += 1,
      text: normalized,
      paragraphIndex,
    })
  })

  tables.forEach((table, tableIndex) => {
    const normalizedRows = table
      .map(row => row.map(cell => normalizeWordCell(cell)))
      .filter(row => row.some(cell => cell))
    if (!normalizedRows.length) return
    blocks.push({
      id: `t-${tableIndex + 1}`,
      type: 'table',
      order: order += 1,
      tableIndex,
      rowCount: normalizedRows.length,
      columnCount: normalizedRows.reduce((max, row) => Math.max(max, row.length), 0),
      sampleRows: normalizedRows.slice(0, 4),
      text: normalizedRows.slice(0, 3).map(row => row.join(' | ')).join('\n'),
    })
  })

  blocks.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

  return {
    file: path.basename(filePath),
    paragraphCount: textExtraction.paragraphCount,
    tableCount: tables.length,
    blocks,
    previewBlocks: blocks.slice(0, 16),
    textPreview: textExtraction.preview,
    warnings: textExtraction.warnings,
    summary: `文档共识别 ${blocks.length} 个块（${paragraphs.filter(item => normalizeWordCell(item)).length} 段正文，${tables.length} 个表格）`,
  }
}

export async function extractWordText(filePath: string) {
  const result = await mammoth.extractRawText({ path: filePath })
  const text = result.value.replace(/\r/g, '').trim()
  const paragraphs = text.split(/\n+/).map(item => item.trim()).filter(Boolean)
  return {
    text,
    preview: paragraphs.slice(0, 12).join('\n').slice(0, 4000),
    paragraphCount: paragraphs.length,
    warnings: result.messages.map(message => message.message),
  }
}

export async function extractWordTextWithMarkItDown(filePath: string) {
  const script = [
    'from markitdown import MarkItDown',
    'import json',
    'import sys',
    'md = MarkItDown()',
    'result = md.convert(sys.argv[1])',
    'print(json.dumps({"text": result.text_content}, ensure_ascii=False))',
  ].join('; ')

  const { stdout } = await execFile(MARKITDOWN_PYTHON, ['-c', script, filePath], {
    maxBuffer: 16 * 1024 * 1024,
  })

  const parsed = JSON.parse(stdout || '{}')
  const text = String(parsed.text || '').replace(/\r/g, '').trim()
  const paragraphs = text.split(/\n+/).map(item => item.trim()).filter(Boolean)
  return {
    text,
    preview: paragraphs.slice(0, 20).join('\n').slice(0, 6000),
    paragraphCount: paragraphs.length,
    warnings: [] as string[],
  }
}

async function extractWordParagraphsRaw(filePath: string): Promise<string[]> {
  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  const documentFile = zip.file('word/document.xml')
  if (!documentFile) return []
  const documentXml = await documentFile.async('string')
  const paragraphs = parseDocumentParagraphs(documentXml)
  return paragraphs.map(paragraph => normalizeWordCell(paragraph.text)).filter(Boolean)
}

export function parseDocumentParagraphs(documentXml: string): ParagraphNode[] {
  const matches = documentXml.match(/<w:p[\s\S]*?<\/w:p>/g) || []
  return matches.map(xml => ({ xml, text: extractTextFromParagraphXml(xml) }))
}

export function parseDocumentTables(documentXml: string): TableNode[] {
  const matches = documentXml.match(/<w:tbl[\s\S]*?<\/w:tbl>/g) || []
  return matches.map(xml => ({ xml, rows: xml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [] }))
}

function extractTextFromParagraphXml(xml: string): string {
  return normalizeWordCell(
    [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map(match => String(match[1]).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
      .join(''),
  )
}

export async function extractWordTables(filePath: string): Promise<string[][][]> {
  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  const documentFile = zip.file('word/document.xml')
  if (!documentFile) return []
  const documentXml = await documentFile.async('string')

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true })
  const parsed = parser.parse(documentXml)
  const tables = normalizeXmlArray(parsed?.document?.body?.tbl)

  return tables.map((table: any) => {
    const rows = normalizeXmlArray(table?.tr)
    return rows.map((row: any) => {
      const cells = normalizeXmlArray(row?.tc)
      return cells.map((cell: any) => extractCellText(cell))
    })
  })
}

function normalizeXmlArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function extractCellText(cell: any): string {
  const paragraphs = normalizeXmlArray(cell?.p)
  const textParts: string[] = []
  for (const paragraph of paragraphs) {
    const runs = normalizeXmlArray(paragraph?.r)
    for (const run of runs) {
      const texts = normalizeXmlArray(run?.t)
      for (const text of texts) {
        if (typeof text === 'string') textParts.push(text)
        else if (text && typeof text['#text'] === 'string') textParts.push(text['#text'])
      }
    }
  }
  return textParts.join('').replace(/\s+/g, ' ').trim()
}
