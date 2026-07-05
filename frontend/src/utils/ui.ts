// 纯前端展示工具函数（不触碰 API）

export function extOf(name: string): string {
  const i = (name || '').lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toUpperCase() : ''
}

/** 文件类型 → uk-file-tag 的配色 class */
export function extClass(name: string): string {
  const e = extOf(name).toLowerCase()
  if (['xlsx', 'xls'].includes(e)) return 'ext-xlsx'
  if (['csv'].includes(e)) return 'ext-csv'
  if (['docx', 'doc'].includes(e)) return 'ext-docx'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) return 'ext-img'
  return ''
}

export function formatFileSize(bytes?: number): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

/** mono 时间戳 HH:MM:SS */
export function formatClock(timestamp?: string): string {
  if (!timestamp) return '--:--'
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) return '--:--'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 相对时间：今天 / 昨天 / M/D */
export function formatDay(timestamp?: string): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (diff <= 0) return '今天'
  if (diff === 1) return '昨天'
  return `${d.getMonth() + 1}/${d.getDate()}`
}
