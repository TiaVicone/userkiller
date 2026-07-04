import fs from 'node:fs/promises'
import path from 'node:path'
import XLSX from 'xlsx'

export interface SpreadsheetSheetPreview {
  name: string
  headers: string[]
  rowCount: number
  sampleRows: string[][]
}

export interface SpreadsheetPreview {
  sheets: SpreadsheetSheetPreview[]
  primarySheetName: string
  primaryHeaders: string[]
  rowCount: number
}

export interface FileInspectionResult {
  file: string
  ext: string
  kind: 'spreadsheet' | 'csv' | 'json' | 'markdown' | 'word' | 'text' | 'pdf' | 'unknown'
  parseable: boolean
  structured: boolean
  executable: boolean
  summary: string
  preview?: unknown
  schema?: {
    headers?: string[]
    topLevelKeys?: string[]
    sheetNames?: string[]
    rowCount?: number
  }
  risks?: string[]
  suggestedOperations: string[]
}

const DEFAULT_SHEET_NAME = '处理结果'

export async function inspectFile(filePath: string): Promise<FileInspectionResult> {
  const ext = path.extname(filePath).toLowerCase()
  const file = path.basename(filePath)

  if (/\.xlsx?$/i.test(file)) {
    const preview = await previewSpreadsheet(filePath)
    return {
      file,
      ext,
      kind: 'spreadsheet',
      parseable: true,
      structured: true,
      executable: true,
      summary: `Excel 文件，共 ${preview.sheets.length} 个工作表，主表 ${preview.primarySheetName}，约 ${preview.rowCount} 行`,
      preview,
      schema: {
        headers: preview.primaryHeaders,
        sheetNames: preview.sheets.map(sheet => sheet.name),
        rowCount: preview.rowCount,
      },
      risks: preview.primaryHeaders.length ? [] : ['未识别到明确表头，后续处理可能不稳定'],
      suggestedOperations: ['预览表结构', '字段识别', '统计汇总', '生成新的 Excel 文件'],
    }
  }

  if (ext === '.csv') {
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.split(/\r?\n/).filter(Boolean)
    const header = (lines[0] || '').split(',').map(item => item.trim())
    return {
      file,
      ext,
      kind: 'csv',
      parseable: true,
      structured: true,
      executable: true,
      summary: `CSV 文件，表头 ${header.length} 列，约 ${Math.max(lines.length - 1, 0)} 行数据`,
      preview: {
        headers: header,
        sampleRows: lines.slice(1, 4).map(line => line.split(',').map(item => item.trim())),
      },
      schema: {
        headers: header,
        rowCount: Math.max(lines.length - 1, 0),
      },
      risks: header.length ? [] : ['CSV 未识别到明确表头'],
      suggestedOperations: ['读取表头', '字段匹配', '汇总统计', '生成 CSV/Excel 结果'],
    }
  }

  if (ext === '.json') {
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content)
    const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 20) : []
    return {
      file,
      ext,
      kind: 'json',
      parseable: true,
      structured: true,
      executable: true,
      summary: `JSON 文件，顶层字段 ${keys.join('、') || '无'}`,
      preview: parsed,
      schema: {
        topLevelKeys: keys,
      },
      risks: keys.length ? [] : ['JSON 顶层为空或不可直接提取字段'],
      suggestedOperations: ['读取结构', '提取字段', '生成结构化结果'],
    }
  }

  if (ext === '.md') {
    const content = await fs.readFile(filePath, 'utf-8')
    return {
      file,
      ext,
      kind: 'markdown',
      parseable: true,
      structured: false,
      executable: false,
      summary: `Markdown 文件，长度 ${content.length} 字符`,
      preview: content.slice(0, 2000),
      risks: [],
      suggestedOperations: ['总结内容', '提取章节', '生成报告'],
    }
  }

  if (ext === '.docx') {
    return {
      file,
      ext,
      kind: 'word',
      parseable: true,
      structured: true,
      executable: false,
      summary: 'Word 文档，需使用 Word 专用工具分析',
      risks: [],
      suggestedOperations: ['使用 read_file 理解 Word 文档结构', '按 blockId / blockType 精读正文或表格', '结构化提取信息'],
    }
  }

  if (ext === '.pdf') {
    const stat = await fs.stat(filePath)
    return {
      file,
      ext,
      kind: 'pdf',
      parseable: true,
      structured: false,
      executable: true,
      summary: `PDF 文件，大小 ${(stat.size / 1024).toFixed(1)} KB。使用 execute_python + pypdf/pdfplumber 提取内容`,
      risks: ['扫描版 PDF 需 OCR，当前沙箱未集成 OCR 库，仅支持文本型 PDF'],
      suggestedOperations: [
        '用 execute_python 调用 pypdf.PdfReader 读取每页文本',
        '用 pdfplumber 提取表格结构',
        '将结果写入 output/pdf-extraction.md 或 xlsx',
      ],
    }
  }

  if (ext === '.txt' || !ext) {
    const content = await fs.readFile(filePath, 'utf-8')
    return {
      file,
      ext,
      kind: 'text',
      parseable: true,
      structured: false,
      executable: false,
      summary: `文本文件，长度 ${content.length} 字符`,
      preview: content.slice(0, 2000),
      risks: [],
      suggestedOperations: ['阅读文本', '总结内容', '提取关键信息'],
    }
  }

  return {
    file,
    ext,
    kind: 'unknown',
    parseable: false,
    structured: false,
    executable: false,
    summary: `暂未内建该文件类型 ${ext || '无扩展名'} 的解析能力`,
    risks: ['文件类型暂不支持直接结构化处理'],
    suggestedOperations: ['尝试复制到 output', '提示用户补充处理要求'],
  }
}

export async function previewSpreadsheet(filePath: string): Promise<SpreadsheetPreview> {
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const sheets = workbook.SheetNames.map(sheetName => {
    const table = readBestTableFromSheet(workbook.Sheets[sheetName], sheetName)
    return {
      name: sheetName,
      headers: table.headers,
      rowCount: table.rows.length,
      sampleRows: table.rows.slice(0, 3).map(row => table.headers.slice(0, 8).map(header => row[header] || '')),
    }
  })

  const primarySheet = [...sheets].sort((a, b) => b.rowCount - a.rowCount)[0] || {
    name: workbook.SheetNames[0] || DEFAULT_SHEET_NAME,
    headers: [],
    rowCount: 0,
    sampleRows: [],
  }

  return {
    sheets,
    primarySheetName: primarySheet.name,
    primaryHeaders: primarySheet.headers,
    rowCount: primarySheet.rowCount,
  }
}

interface TableData {
  headers: string[]
  rows: Array<Record<string, string>>
  sheetName: string
}

function readBestTableFromSheet(sheet: XLSX.WorkSheet | undefined, sheetName: string): TableData {
  if (!sheet) return { headers: [], rows: [], sheetName }
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: '',
  })

  const normalizedRows = matrix
    .map(row => row.map(cell => normalizeCell(cell)))
    .filter(row => row.some(Boolean))

  if (!normalizedRows.length) {
    return { headers: [], rows: [], sheetName }
  }

  const headerRowIndex = findHeaderRowIndex(normalizedRows)
  const headerRow = normalizedRows[headerRowIndex] || []
  const headers = headerRow.map((value, index) => value || `列${index + 1}`)
  const dataRows = normalizedRows.slice(headerRowIndex + 1)
    .filter(row => row.some(Boolean))
    .map(row => headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = row[index] || ''
      return acc
    }, {}))

  return {
    headers,
    rows: dataRows,
    sheetName,
  }
}

function findHeaderRowIndex(rows: string[][]): number {
  let bestIndex = 0
  let bestScore = -1

  rows.slice(0, 8).forEach((row, index) => {
    const score = scoreHeaderRow(row)
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  })

  return bestIndex
}

function scoreHeaderRow(row: string[]): number {
  const nonEmptyCells = row.filter(Boolean)
  if (!nonEmptyCells.length) return -1

  let score = nonEmptyCells.length
  for (const cell of nonEmptyCells) {
    if (/[姓名单位活动标题部门名称链接网址]/.test(cell)) score += 3
    if (/^\d+[、.．]/.test(cell)) score += 2
    if (cell.length <= 20) score += 1
  }
  return score
}

function normalizeCell(value: unknown): string {
  return String(value ?? '').trim()
}

export function inferDesiredOutput(params: {
  userInput: string
  workspaceFiles: string[]
}): { type: string; reason: string } {
  const text = params.userInput.toLowerCase()
  const workspaceFiles = params.workspaceFiles.map(name => name.toLowerCase())

  if (text.includes('excel') || text.includes('表格') || text.includes('xlsx') || workspaceFiles.some(name => /\.xlsx?$/.test(name))) {
    return { type: 'xlsx', reason: '用户需求或输入文件指向 Excel 表格处理' }
  }

  if (text.includes('csv') || workspaceFiles.some(name => name.endsWith('.csv'))) {
    return { type: 'csv', reason: '用户需求或输入文件指向 CSV 处理' }
  }

  if (text.includes('word') || text.includes('docx')) {
    return { type: 'docx', reason: '用户需求指向 Word 文档处理' }
  }

  if (text.includes('json')) {
    return { type: 'json', reason: '用户需求指向结构化 JSON 输出' }
  }

  return { type: 'md', reason: '未识别明确文件交付类型，回退为文本结果' }
}
