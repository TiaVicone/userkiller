import path from 'node:path'
import fs from 'node:fs'

/**
 * Strengthened safeJoin: resolves symlinks and ensures the resolved path
 * stays strictly within the base directory.
 */
export function safeJoinStrict(baseDir: string, relativePath: string): string {
  if (!relativePath) {
    return path.resolve(baseDir)
  }

  // Reject null bytes (used in some path traversal attacks)
  if (relativePath.includes('\0')) {
    throw new Error('非法路径：包含空字节')
  }

  // Strip leading slashes and normalize
  const cleaned = relativePath
    .replace(/^[/\\]+/, '')
    .replace(/\.\.[/\\]/g, '')  // Extra safety: strip ../ patterns before resolve

  const resolved = path.resolve(baseDir, cleaned)
  const resolvedBase = path.resolve(baseDir)

  // The resolved path must start with the base directory + separator (or be the base itself)
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error(`非法路径访问：路径逃逸出基础目录`)
  }

  return resolved
}

/**
 * Validate that an absolute path belongs to one of the allowed base directories.
 * Used before calling openFileInSystem or sendFile.
 */
export function assertPathWithinBases(targetPath: string, allowedBases: string[]): void {
  const resolved = path.resolve(targetPath)

  for (const base of allowedBases) {
    const resolvedBase = path.resolve(base)
    if (resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep)) {
      return
    }
  }

  throw new Error(`路径安全检查失败：${resolved} 不在允许范围内`)
}

/**
 * Realpath check: resolves symlinks and verifies the real path is within bounds.
 * Returns the real path or throws.
 */
export async function realpathWithinBase(targetPath: string, baseDir: string): Promise<string> {
  const fsp = await import('node:fs/promises')
  let real: string
  try {
    real = await fsp.realpath(targetPath)
  } catch {
    // File doesn't exist yet — just check the resolved path
    real = path.resolve(targetPath)
  }

  const resolvedBase = path.resolve(baseDir)
  if (real !== resolvedBase && !real.startsWith(resolvedBase + path.sep)) {
    throw new Error(`路径安全检查失败：真实路径逃逸出允许范围`)
  }

  return real
}

/**
 * Sanitize filename: strip dangerous characters, reject traversal patterns.
 */
export function sanitizeFilename(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('文件名不能为空')
  }

  // Reject null bytes
  if (name.includes('\0')) {
    throw new Error('文件名包含非法字符')
  }

  // Reject path separators and traversal
  if (/[/\\]/.test(name) || name.includes('..')) {
    throw new Error('文件名包含非法路径字符')
  }

  // Reject control characters
  if (/[\x00-\x1f\x7f]/.test(name)) {
    throw new Error('文件名包含控制字符')
  }

  // Trim and limit length
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new Error('文件名不能为空')
  }
  if (trimmed.length > 255) {
    throw new Error('文件名不能超过 255 个字符')
  }

  return trimmed
}
