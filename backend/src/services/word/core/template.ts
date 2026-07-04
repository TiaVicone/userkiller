import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import type { WordTemplateSlot, ExtractedWordField, ParagraphNode, TableNode, TemplateFillTarget } from '../types.js'
import { 
  normalizeWordCell, 
  extractTemplateLabel, 
  normalizeExtractedFieldName,
  scoreFieldSlotMatch,
  escapeXmlText,
  extractTextFromTableCellXml,
} from './utils.js'
import { extractWordTables, parseDocumentParagraphs, parseDocumentTables } from './extract.js'
import { extractWordFieldValues, inspectWordTemplateSlots } from './inspect.js'
import { replaceParagraphTextNode } from './patch.js'

export async function matchWordFieldsToTemplate(params: { sourcePath: string; templatePath: string }) {
  const extractedFields = await extractWordFieldValues(params.sourcePath)
  const templateSlots = await inspectWordTemplateSlots(params.templatePath)
  
  const scoredMappings = templateSlots.slots.map(slot => {
    const candidates = extractedFields.fields
      .map(field => ({
        field,
        score: scoreFieldSlotMatch(field.field, slot.label),
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.field.field.localeCompare(b.field.field, 'zh-CN'))

    const best = candidates[0]
    return {
      slot: slot.label,
      slotSource: slot.source,
      slotLocation: {
        blockId: slot.blockId || null,
        tableIndex: slot.tableIndex ?? null,
        rowIndex: slot.rowIndex ?? null,
        columnIndex: slot.columnIndex ?? null,
      },
      matchedField: best?.field.field || null,
      value: best?.field.value || null,
      confidence: best ? best.score : 0,
      source: best?.field.source || null,
      slotContext: slot.context,
      fieldContext: best?.field.context,
    }
  })
  
  const mappings = scoredMappings.filter(item => item.matchedField)
  const unmatchedSlots = scoredMappings
    .filter(item => !item.matchedField)
    .map(item => ({
      slot: item.slot,
      slotSource: item.slotSource,
      slotLocation: item.slotLocation,
      slotContext: item.slotContext,
    }))
  
  const matchedFields = new Set(mappings.map(item => String(item.matchedField)))
  const unmatchedFields = extractedFields.fields
    .filter(field => !matchedFields.has(field.field))
    .slice(0, 120)

  return {
    slotCount: templateSlots.slotCount,
    fieldCount: extractedFields.fieldCount,
    mappingCount: mappings.length,
    unmatchedSlotCount: unmatchedSlots.length,
    unmatchedFieldCount: unmatchedFields.length,
    mappings: mappings.slice(0, 120),
    unmatchedSlots,
    unmatchedFields,
    summary: mappings.length
      ? `已完成 ${mappings.length} 个模板字段匹配，未命中槽位 ${unmatchedSlots.length} 个`
      : '暂未形成可靠的字段匹配结果',
  }
}

export async function fillWordTemplateFromMapping(params: {
  templatePath: string
  outputPath: string
  mappings: Array<{ slot: string; value: string | null }>
}) {
  const buffer = await fs.readFile(params.templatePath)
  const zip = await JSZip.loadAsync(buffer)
  const documentFile = zip.file('word/document.xml')
  if (!documentFile) throw new Error('模板中缺少 word/document.xml，无法回填')

  let documentXml = await documentFile.async('string')
  const paragraphs = parseDocumentParagraphs(documentXml)
  const tableNodes = parseDocumentTables(documentXml)
  const replacements = params.mappings.filter(item => item.slot && item.value)
  let paragraphReplacedCount = 0
  let tableCellReplacedCount = 0

  for (const item of replacements) {
    const slotValue = String(item.value || '')
    let replacedInParagraph = false
    const target = locateTemplateFillTarget(paragraphs, item.slot)
    
    if (target) {
      const nextXml = fillParagraphNode(paragraphs[target.paragraphIndex].xml, slotValue, target.mode)
      if (nextXml !== paragraphs[target.paragraphIndex].xml) {
        documentXml = documentXml.replace(paragraphs[target.paragraphIndex].xml, nextXml)
        paragraphs[target.paragraphIndex] = {
          ...paragraphs[target.paragraphIndex],
          xml: nextXml,
          text: extractTextFromParagraphXml(nextXml),
        }
        paragraphReplacedCount += 1
        replacedInParagraph = true
      }
    }

    if (replacedInParagraph) continue
    
    const tableTargets = locateTemplateTableFillTargets(tableNodes, item.slot)
    for (const tableTarget of tableTargets) {
      const tableNode = tableNodes[tableTarget.tableIndex]
      if (!tableNode) continue
      const nextTableXml = replaceTableCellTextNode(tableNode.xml, tableTarget.rowIndex, tableTarget.columnIndex, slotValue)
      if (nextTableXml === tableNode.xml) continue
      documentXml = documentXml.replace(tableNode.xml, nextTableXml)
      tableNodes[tableTarget.tableIndex] = { ...tableNode, xml: nextTableXml }
      tableCellReplacedCount += 1
    }
  }

  zip.file('word/document.xml', documentXml)
  const outputBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  await fs.mkdir(path.dirname(params.outputPath), { recursive: true })
  await fs.writeFile(params.outputPath, outputBuffer)

  return {
    outputPath: params.outputPath,
    replacedCount: paragraphReplacedCount + tableCellReplacedCount,
    paragraphReplacedCount,
    tableCellReplacedCount,
  }
}

function locateTemplateFillTarget(paragraphs: ParagraphNode[], slot: string): TemplateFillTarget | null {
  const normalizedSlot = normalizeWordCell(slot)
  const slotChars = [...normalizedSlot]

  for (let index = 0; index < paragraphs.length; index += 1) {
    const current = paragraphs[index]
    const normalizedText = normalizeWordCell(current.text)
    const splitMatch = slotChars.every(char => normalizedText.includes(char))
    const directMatch = normalizedText.includes(normalizedSlot)
    if (!directMatch && !splitMatch) continue

    for (let offset = 1; offset <= 3; offset += 1) {
      const candidate = paragraphs[index + offset]
      if (!candidate) break
      const candidateText = normalizeWordCell(candidate.text)
      if (!candidateText) {
        return { slot: normalizedSlot, paragraphIndex: index + offset, mode: 'replace_empty_paragraph' }
      }
      if (extractTemplateLabel(candidateText)) break
    }

    return { slot: normalizedSlot, paragraphIndex: index, mode: 'append_after_label' }
  }

  return null
}

function locateTemplateTableFillTargets(
  tables: TableNode[],
  slot: string,
): Array<{ tableIndex: number; rowIndex: number; columnIndex: number }> {
  const normalizedSlot = normalizeWordCell(slot)
  if (!normalizedSlot) return []
  const slotChars = [...normalizedSlot]
  const targets: Array<{ tableIndex: number; rowIndex: number; columnIndex: number }> = []

  tables.forEach((table, tableIndex) => {
    const rows = table.xml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || []
    rows.forEach((rowXml, rowIndex) => {
      const cells = rowXml.match(/<w:tc[\s\S]*?<\/w:tc>/g) || []
      cells.forEach((cellXml, columnIndex) => {
        const cellText = extractTextFromTableCellXml(cellXml)
        if (!cellText) return
        const directMatch = cellText.includes(normalizedSlot)
        const splitMatch = slotChars.every(char => cellText.includes(char))
        if (directMatch || splitMatch) {
          targets.push({ tableIndex, rowIndex, columnIndex })
        }
      })
    })
  })

  return targets
}

function fillParagraphNode(paragraphXml: string, value: string, mode: TemplateFillTarget['mode']): string {
  const escapedValue = escapeXmlText(value)

  if (mode === 'replace_empty_paragraph') {
    if (/<w:t[^>]*>\s*<\/w:t>/.test(paragraphXml)) {
      return paragraphXml.replace(/<w:t[^>]*>\s*<\/w:t>/, match => match.replace(/>\s*</, `>${escapedValue}<`))
    }
    if (/<w:r[^>]*>[\s\S]*?<\/w:r>/.test(paragraphXml)) {
      return paragraphXml.replace(/(<w:r[^>]*>[\s\S]*?<w:rPr[\s\S]*?<\/w:rPr>)/, `$1<w:t xml:space="preserve">${escapedValue}</w:t>`)
    }
  }

  if (mode === 'append_after_label') {
    if (/<w:t[^>]*>\s*<\/w:t>/.test(paragraphXml)) {
      return paragraphXml.replace(/<w:t[^>]*>\s*<\/w:t>/, match => match.replace(/>\s*</, `>${escapedValue}<`))
    }
    return paragraphXml.replace(/<\/w:p>$/, `<w:r><w:t xml:space="preserve">${escapedValue}</w:t></w:r></w:p>`)
  }

  return paragraphXml
}

function replaceTableCellTextNode(tableXml: string, rowIndex: number, columnIndex: number, value: string): string {
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

function extractTextFromParagraphXml(xml: string): string {
  return normalizeWordCell(
    [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map(match => String(match[1]).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
      .join(''),
  )
}
