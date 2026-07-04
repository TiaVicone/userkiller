import type { WordTableInspection, ExtractedWordField, WordTemplateSlot } from '../types.js'
import {
  normalizeWordCell,
  looksLikeHeaderCell,
  extractTemplateLabel,
  normalizeExtractedFieldName,
  isLikelyFieldValueForLabel,
  splitMarkdownTableCells,
  splitMergedLabels,
  splitMergedFieldValues,
  extractInlineFieldValue,
  isLikelyFieldValue,
} from './utils.js'
import { extractWordText, extractWordTables, extractWordTextWithMarkItDown } from './extract.js'

export async function inspectWordTables(filePath: string) {
  const tables = await extractWordTables(filePath)
  const inspections: WordTableInspection[] = tables.map((table, index) => {
    const normalizedRows = table
      .map(row => row.map(cell => normalizeWordCell(cell)))
      .filter(row => row.some(cell => cell))

    const columnCount = normalizedRows.reduce((max, row) => Math.max(max, row.length), 0)
    const headerCandidates = normalizedRows
      .slice(0, 3)
      .filter(row => row.some(cell => looksLikeHeaderCell(cell)))
      .map(row => row.map(cell => cell.trim()).filter(Boolean))

    return {
      tableIndex: index,
      rowCount: normalizedRows.length,
      columnCount,
      nonEmptyRowCount: normalizedRows.filter(row => row.some(cell => cell)).length,
      headerCandidates,
      sampleRows: normalizedRows.slice(0, 5),
      normalizedRows: normalizedRows.slice(0, 12),
    }
  })

  return {
    tableCount: inspections.length,
    inspections,
    summary: inspections.length
      ? `共识别 ${inspections.length} 个表格，其中最大表格约 ${Math.max(...inspections.map(item => item.rowCount))} 行`
      : '未识别到表格',
  }
}

export async function extractWordFieldValues(filePath: string) {
  const extracted = await extractWordTextWithMarkItDown(filePath)
  const tables = await extractWordTables(filePath)
  const fields: ExtractedWordField[] = []
  const seen = new Set<string>()
  const paragraphLines = extracted.text.split(/\n+/).map(line => normalizeWordCell(line)).filter(Boolean)

  for (let index = 0; index < paragraphLines.length; index += 1) {
    const line = paragraphLines[index]

    const markdownCells = splitMarkdownTableCells(line)
    if (markdownCells.length >= 2) {
      for (let cellIndex = 0; cellIndex < markdownCells.length - 1; cellIndex += 1) {
        const currentCell = markdownCells[cellIndex]
        const nextCell = markdownCells[cellIndex + 1]

        const splitLabels = splitMergedLabels(currentCell)
        if (splitLabels.length > 1) {
          const splitValues = splitMergedFieldValues(nextCell)
          splitLabels.forEach((rawLabel, splitIndex) => {
            const label = normalizeExtractedFieldName(rawLabel)
            const value = normalizeWordCell(splitValues[splitIndex] || '')
            if (!label || !value || !isLikelyFieldValueForLabel(label, value)) return
            const key = `${label}:${value}`
            if (seen.has(key)) return
            seen.add(key)
            fields.push({ field: label, value, source: 'table', context: markdownCells.join(' | ') })
          })
        }

        const label = normalizeExtractedFieldName(extractTemplateLabel(currentCell))
        const value = normalizeWordCell(nextCell)
        if (!label || !value || !isLikelyFieldValueForLabel(label, value)) continue
        const key = `${label}:${value}`
        if (seen.has(key)) continue
        seen.add(key)
        fields.push({ field: label, value, source: 'table', context: markdownCells.join(' | ') })
      }
    }

    const inlineMatch = extractInlineFieldValue(line)
    if (inlineMatch) {
      const normalizedField = normalizeExtractedFieldName(inlineMatch.field)
      const normalizedValue = normalizeWordCell(inlineMatch.value)
      if (!isLikelyFieldValueForLabel(normalizedField, normalizedValue)) continue
      const key = `${normalizedField}:${normalizedValue}`
      if (!seen.has(key)) {
        seen.add(key)
        fields.push({ field: normalizedField, value: normalizedValue, source: 'paragraph', context: line })
      }
      continue
    }

    const label = extractTemplateLabel(line)
    if (!label) continue
    const normalizedLabel = normalizeExtractedFieldName(label)

    const nextCandidates = paragraphLines.slice(index + 1, index + 6).filter(Boolean)
    const subsequentLabels = nextCandidates.filter(candidate => extractTemplateLabel(candidate))
    const subsequentValues = nextCandidates.filter(candidate => !extractTemplateLabel(candidate) && isLikelyFieldValue(candidate))
    const valueIndex = subsequentLabels.length > 0 && subsequentValues.length >= subsequentLabels.length
      ? subsequentLabels.indexOf(label) >= 0 ? subsequentLabels.indexOf(label) : 0
      : 0
    const nextValue = normalizeWordCell(subsequentValues[valueIndex] || subsequentValues[0] || '')

    if (nextValue && isLikelyFieldValueForLabel(normalizedLabel, nextValue)) {
      const key = `${normalizedLabel}:${nextValue}`
      if (!seen.has(key)) {
        seen.add(key)
        fields.push({ field: normalizedLabel, value: nextValue, source: 'paragraph', context: `${line} -> ${nextValue}` })
      }
    }
  }

  tables.forEach(table => {
    table.forEach(row => {
      const normalizedRow = row.map(cell => normalizeWordCell(cell))
      for (let index = 0; index < normalizedRow.length - 1; index += 1) {
        const label = normalizeExtractedFieldName(extractTemplateLabel(normalizedRow[index]))
        const value = normalizeWordCell(normalizedRow[index + 1])
        if (!label || !value || !isLikelyFieldValueForLabel(label, value)) continue
        const key = `${label}:${value}`
        if (seen.has(key)) continue
        seen.add(key)
        fields.push({ field: label, value, source: 'table', context: normalizedRow.filter(Boolean).join(' | ') })
      }
    })
  })

  return {
    fieldCount: fields.length,
    fields: fields.slice(0, 120),
    summary: fields.length
      ? `提取到 ${fields.length} 个字段值，例如：${fields.slice(0, 8).map(item => `${item.field}=${item.value}`).join('；')}`
      : '暂未提取到明确字段值',
  }
}

export async function inspectWordTemplateSlots(filePath: string) {
  const extracted = await extractWordText(filePath)
  const tables = await extractWordTables(filePath)
  const slots: WordTemplateSlot[] = []
  const seen = new Set<string>()

  const paragraphLines = extracted.text.split(/\n+/).map(line => normalizeWordCell(line)).filter(Boolean)
  for (let index = 0; index < paragraphLines.length; index += 1) {
    const line = paragraphLines[index]
    const label = extractTemplateLabel(line)
    if (!label) continue
    const key = `paragraph:${label}`
    if (seen.has(key)) continue
    seen.add(key)
    slots.push({ label, source: 'paragraph', blockId: `p-${index + 1}`, context: line })
  }

  tables.forEach((table, tableIndex) => {
    table.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        const normalizedCell = normalizeWordCell(cell)
        const label = extractTemplateLabel(normalizedCell)
        if (!label) return
        const key = `table:${tableIndex}:${label}`
        if (seen.has(key)) return
        seen.add(key)
        slots.push({
          label,
          source: 'table',
          blockId: `t-${tableIndex + 1}`,
          tableIndex,
          rowIndex,
          columnIndex,
          context: row.map(item => normalizeWordCell(item)).filter(Boolean).join(' | '),
        })
      })
    })
  })

  return {
    slotCount: slots.length,
    slots: slots.slice(0, 80),
    summary: slots.length
      ? `识别到 ${slots.length} 个可填写字段候选，例如：${slots.slice(0, 8).map(slot => slot.label).join('、')}`
      : '暂未识别到明确的可填写字段候选',
  }
}
