export function normalizeWordCell(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function normalizeWordLabel(value: string): string {
  return normalizeWordCell(value).replace(/\s+/g, '')
}

export function escapeXmlText(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function decodeXmlText(value: string): string {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function looksLikeHeaderCell(value: string): boolean {
  const text = normalizeWordCell(value)
  if (!text) return false
  if (text.length <= 12 && /姓名|名称|部门|单位|序号|日期|得分|等级|票数|结果|备注|项目|内容/.test(text)) return true
  if (text.length <= 8 && /^[一二三四五六七八九十0-9A-Za-z]+$/.test(text)) return true
  return false
}

export function getParagraphIndexFromBlockId(blockId: string): number {
  const matched = String(blockId || '').match(/^p-(\d+)$/)
  return matched ? Math.max(0, Number(matched[1]) - 1) : -1
}

export function getTableIndexFromBlockId(blockId: string): number {
  const matched = String(blockId || '').match(/^t-(\d+)$/)
  return matched ? Math.max(0, Number(matched[1]) - 1) : -1
}

export function extractTextFromParagraphXml(xml: string): string {
  return normalizeWordCell(
    [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map(match => decodeXmlText(match[1]))
      .join(''),
  )
}

export function extractTextFromTableCellXml(cellXml: string): string {
  return normalizeWordCell(
    [...cellXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map(match => decodeXmlText(match[1]))
      .join(''),
  )
}

const KNOWN_LABELS = [
  '姓名', '性别', '出生日期', '出生年月', '出生地', '籍贯', '民族', '年龄', '入党时间', '参加工作时间', '健康状况', '专业技术职务',
  '熟悉专业有何专长', '学历', '学位', '毕业院校', '系及专业', '岗位', '岗级', '简历', '奖惩情况', '年度考核结果',
  '任免理由', '家庭主要成员及重要社会关系', '称谓', '工作单位及职务', '呈报单位', '审批机关意见', '行政任免机关意见',
]

export function splitMergedLabels(value: string): string[] {
  const text = normalizeWordLabel(value)
  if (!text) return []
  const matches = KNOWN_LABELS.filter(label => text.includes(label))
  return matches.sort((a, b) => text.indexOf(a) - text.indexOf(b))
}

export function extractTemplateLabel(value: string): string {
  const text = normalizeWordLabel(value)
  if (!text) return ''
  if (text.length > 20) return ''
  if (/^[0-9A-Za-z]+$/.test(text)) return ''

  const merged = splitMergedLabels(text)
  if (merged.length === 1) return merged[0]
  if (merged.length > 1) return ''

  if (/^[\u4e00-\u9fff]{1,12}$/.test(text) && /姓名|性别|出生日期|出生年月|年龄|出生地|籍贯|民族|入党|时间|参加工作时间|健康状况|专业技术职务|熟悉专业有何专长|学历|学位|毕业院校|系及专业|岗位|岗级|简历|奖惩情况|年度考核结果|任免理由|家庭主要成员及重要社会关系|称谓|工作单位及职务|呈报单位|审批机关意见|行政任免机关意见/.test(text)) {
    return text
  }
  if (/[:：]$/.test(text)) {
    return text.replace(/[:：]+$/, '')
  }
  if (/姓名|性别|出生日期|出生年月|年龄|出生地|籍贯|民族|入党|时间|参加工作时间|健康状况|专业技术职务|学历|学位|毕业院校|系及专业|岗位|岗级|简历|奖惩情况|年度考核结果|任免理由|家庭主要成员及重要社会关系|称谓|工作单位及职务/.test(text)) {
    return text.replace(/[:：]+$/, '')
  }
  return ''
}

export function normalizeExtractedFieldName(field: string): string {
  const text = normalizeWordLabel(field)
  if (text === '作时间') return '参加工作时间'
  if (text === '出生年月') return '出生日期'
  return text
}

export function isLikelyFieldValue(value: string): boolean {
  const text = normalizeWordCell(value)
  if (!text) return false
  if (text.length > 80) return false
  if (text.startsWith('|') && text.includes('|')) return false
  if (extractTemplateLabel(text)) return false
  return /[\u4e00-\u9fffA-Za-z0-9]/.test(text)
}

export function isLikelyFieldValueForLabel(label: string, value: string): boolean {
  const normalizedLabel = normalizeExtractedFieldName(label)
  const text = normalizeWordCell(value)
  if (!isLikelyFieldValue(text)) return false

  if (normalizedLabel === '出生日期' || normalizedLabel === '出生年月' || normalizedLabel === '参加工作时间') {
    return /\d{4}[.\-/年]\d{1,2}/.test(text)
  }
  if (normalizedLabel === '出生地' || normalizedLabel === '籍贯') {
    return /[\u4e00-\u9fff]{2,12}/.test(text)
  }
  if (normalizedLabel === '民族') {
    return /汉族|回族|满族|蒙古族|藏族|苗族|壮族|维吾尔族|土家族|朝鲜族|彝族/.test(text) || /^[\u4e00-\u9fff]{1,4}$/.test(text)
  }
  if (normalizedLabel === '性别') return /^(男|女)$/.test(text)
  if (normalizedLabel === '健康状况') return /健康|良好|一般/.test(text)
  if (normalizedLabel === '岗级') return /\d|\//.test(text)
  if (normalizedLabel === '毕业院校') return /大学|学院|学校/.test(text)
  if (normalizedLabel === '系及专业') return /专业|科学|技术|工程|管理|经济|文学|法学|教育|医学/.test(text)
  if (normalizedLabel === '姓名') return /^[\u4e00-\u9fff]{2,4}$/.test(text) && !/政治|群众|面貌|父亲|母亲/.test(text)
  if (normalizedLabel === '称谓') return /父亲|母亲|配偶|儿子|女儿|岳父|岳母/.test(text)
  return true
}

export function splitMarkdownTableCells(value: string): string[] {
  const text = String(value || '').trim()
  if (!text.startsWith('|') || !text.endsWith('|')) return []
  if (/^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(text)) return []
  return text.split('|').slice(1, -1).map(cell => normalizeWordCell(cell)).filter(Boolean)
}

export function splitMergedFieldValues(value: string): string[] {
  const text = normalizeWordCell(value)
  if (!text) return []

  const patterns = [
    /([\u4e00-\u9fff]{2,4})\s+(男|女)\s+(\d{4}[.\-/年]\d{1,2}(?:[.\-/月]\d{1,2})?)$/,
    /([\u4e00-\u9fff]{1,4})\s+([\u4e00-\u9fff]{2,12})\s+([\u4e00-\u9fff]{2,12})$/,
    /(大学本科|硕士研究生|博士研究生|本科|硕士|博士)\s+(.+)$/,
  ]

  for (const pattern of patterns) {
    const matched = text.match(pattern)
    if (matched) return matched.slice(1).map(item => normalizeWordCell(item))
  }

  return text.split(/\s{2,}|\t+/).map(item => normalizeWordCell(item)).filter(Boolean)
}

export function extractInlineFieldValue(value: string): { field: string; value: string } | null {
  const text = normalizeWordCell(value)
  const matched = text.match(/^(.{1,20}?)[：:](.+)$/)
  if (!matched) return null
  const field = extractTemplateLabel(matched[1])
  const fieldValue = normalizeWordCell(matched[2])
  if (!field || !fieldValue || !isLikelyFieldValue(fieldValue)) return null
  return { field, value: fieldValue }
}

export function scoreFieldSlotMatch(field: string, slot: string): number {
  const normalizedField = normalizeWordCell(field)
  const normalizedSlot = normalizeWordCell(slot)
  if (!normalizedField || !normalizedSlot) return 0
  if (normalizedField === normalizedSlot) return 1
  if (normalizedField.includes(normalizedSlot) || normalizedSlot.includes(normalizedField)) return 0.85

  const aliasGroups = [
    ['出生日期', '出生年月', '出生时间'],
    ['参加工作时间', '参加工作日期', '工作时间'],
    ['工作单位及职务', '工作单位', '单位及职务'],
    ['毕业院校', '毕业学校'],
    ['系及专业', '专业'],
    ['姓名', '名字'],
    ['籍贯', '祖籍'],
  ]

  for (const group of aliasGroups) {
    if (group.includes(normalizedField) && group.includes(normalizedSlot)) return 0.75
  }

  return 0
}
