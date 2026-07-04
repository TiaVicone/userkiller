export interface WordBlock {
  id: string
  type: 'paragraph' | 'table'
  order: number
  text?: string
  paragraphIndex?: number
  tableIndex?: number
  rowCount?: number
  columnCount?: number
  sampleRows?: string[][]
}

export interface WordDocumentStructure {
  file: string
  paragraphCount: number
  tableCount: number
  blocks: WordBlock[]
  previewBlocks: WordBlock[]
  textPreview: string
  warnings: string[]
  summary: string
}

export type WordPatchOp = 'replace_paragraph_text' | 'replace_table_cell'

export interface WordPatch {
  op: WordPatchOp
  blockId: string
  text?: string
  rowIndex?: number
  columnIndex?: number
}

export interface WordPatchApplyResult {
  outputPath: string
  appliedCount: number
  skippedCount: number
  patches: WordPatch[]
}

export interface ExtractedWordField {
  field: string
  value: string
  source: 'paragraph' | 'table'
  context?: string
}

export interface WordTemplateSlot {
  label: string
  source: 'paragraph' | 'table'
  blockId?: string
  tableIndex?: number
  rowIndex?: number
  columnIndex?: number
  context?: string
}

export interface WordTableInspection {
  tableIndex: number
  rowCount: number
  columnCount: number
  nonEmptyRowCount: number
  headerCandidates: string[][]
  sampleRows: string[][]
  normalizedRows: string[][]
}

export interface ParagraphNode {
  text: string
  xml: string
}

export interface TableNode {
  xml: string
  rows: string[]
}

export interface TemplateFillTarget {
  slot: string
  paragraphIndex: number
  mode: 'replace_empty_paragraph' | 'append_after_label'
}
