import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import type { WordPatch, WordPatchApplyResult, ParagraphNode, TableNode } from '../types.js'
import { getParagraphIndexFromBlockId, getTableIndexFromBlockId, normalizeWordCell, escapeXmlText, decodeXmlText } from './utils.js'
import { parseDocumentParagraphs, parseDocumentTables } from './extract.js'

export async function applyWordPatches(params: {
  templatePath: string
  outputPath: string
  patches: WordPatch[]
}): Promise<WordPatchApplyResult> {
  const buffer = await fs.readFile(params.templatePath)
  const zip = await JSZip.loadAsync(buffer)
  const documentFile = zip.file('word/document.xml')
  if (!documentFile) throw new Error('模板中缺少 word/document.xml，无法应用补丁')

  let documentXml = await documentFile.async('string')
  const paragraphNodes = parseDocumentParagraphs(documentXml)
  const tableNodes = parseDocumentTables(documentXml)
  let appliedCount = 0
  let skippedCount = 0

  for (const patch of params.patches) {
    if (patch.op === 'replace_paragraph_text') {
      const paragraphIndex = getParagraphIndexFromBlockId(patch.blockId)
      const paragraph = paragraphIndex >= 0 ? paragraphNodes[paragraphIndex] : undefined
      if (!paragraph || typeof patch.text !== 'string') { skippedCount += 1; continue }

      const nextXml = replaceParagraphTextNode(paragraph.xml, patch.text)
      if (nextXml === paragraph.xml) { skippedCount += 1; continue }

      documentXml = documentXml.replace(paragraph.xml, nextXml)
      paragraphNodes[paragraphIndex] = { xml: nextXml, text: normalizeWordCell(patch.text) }
      appliedCount += 1
      continue
    }

    if (patch.op === 'replace_table_cell') {
      const tableIndex = getTableIndexFromBlockId(patch.blockId)
      const rowIndex = Number(patch.rowIndex)
      const columnIndex = Number(patch.columnIndex)
      const tableNode = tableIndex >= 0 ? tableNodes[tableIndex] : undefined
      if (!tableNode || !Number.isInteger(rowIndex) || !Number.isInteger(columnIndex) || typeof patch.text !== 'string') {
        skippedCount += 1; continue
      }

      const nextTableXml = replaceTableCellTextNode(tableNode.xml, rowIndex, columnIndex, patch.text)
      if (nextTableXml === tableNode.xml) { skippedCount += 1; continue }

      documentXml = documentXml.replace(tableNode.xml, nextTableXml)
      tableNodes[tableIndex] = { ...tableNode, xml: nextTableXml }
      appliedCount += 1
    }
  }

  zip.file('word/document.xml', documentXml)
  const outputBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  await fs.mkdir(path.dirname(params.outputPath), { recursive: true })
  await fs.writeFile(params.outputPath, outputBuffer)

  return { outputPath: params.outputPath, appliedCount, skippedCount, patches: params.patches }
}

export function replaceParagraphTextNode(paragraphXml: string, value: string): string {
  const escapedValue = escapeXmlText(value)
  const firstTextMatch = paragraphXml.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/)
  if (firstTextMatch) {
    let replaced = false
    return paragraphXml.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/g, match => {
      if (replaced) return ''
      replaced = true
      return `<w:t xml:space="preserve">${escapedValue}</w:t>`
    })
  }
  return paragraphXml.replace(/<\/w:p>$/, `<w:r><w:t xml:space="preserve">${escapedValue}</w:t></w:r></w:p>`)
}

export function replaceTableCellTextNode(tableXml: string, rowIndex: number, columnIndex: number, value: string): string {
  const rowMatches = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || []
  const targetRow = rowMatches[rowIndex]
  if (!targetRow) return tableXml

  const cellMatches = targetRow.match(/<w:tc[\s\S]*?<\/w:tc>/g) || []
  const targetCell = cellMatches[columnIndex]
  if (!targetCell) return tableXml

  const paragraphs = targetCell.match(/<w:p[\s\S]*?<\/w:p>/g) || []
  const firstParagraph = paragraphs[0]
  const nextParagraph = firstParagraph
    ? replaceParagraphTextNode(firstParagraph, value)
    : `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(value)}</w:t></w:r></w:p>`

  const nextCellXml = firstParagraph
    ? targetCell.replace(firstParagraph, nextParagraph)
    : targetCell.replace(/<\/w:tc>$/, `${nextParagraph}</w:tc>`)

  const nextRowXml = targetRow.replace(targetCell, nextCellXml)
  return tableXml.replace(targetRow, nextRowXml)
}
