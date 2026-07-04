import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import JSZip from 'jszip'

const execFileAsync = promisify(execFile)

export async function detectWordFormat(filePath: string): Promise<'docx' | 'doc' | 'unknown'> {
  const buffer = await fs.readFile(filePath)
  const header = buffer.subarray(0, 8)
  const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04])

  if (header.subarray(0, 4).equals(zipHeader)) return 'docx'
  if (header.equals(oleHeader)) return 'doc'
  return 'unknown'
}

async function findLibreOfficeBinary() {
  const candidates = [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/local/bin/soffice',
    '/opt/homebrew/bin/soffice',
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // continue
    }
  }

  return null
}

async function validateDocx(filePath: string) {
  const format = await detectWordFormat(filePath)
  if (format !== 'docx') {
    throw new Error(`转换结果不是有效 .docx 文件，检测到格式：${format}`)
  }

  const stat = await fs.stat(filePath)
  if (stat.size < 1024) {
    throw new Error(`转换结果文件过小（${stat.size} bytes），疑似转换失败`)
  }

  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  const requiredEntries = ['[Content_Types].xml', 'word/document.xml']
  const missing = requiredEntries.filter(entry => !zip.file(entry))
  if (missing.length) {
    throw new Error(`转换结果缺少 docx 必需结构：${missing.join(', ')}`)
  }

  const documentXml = await zip.file('word/document.xml')!.async('string')
  const textSignalCount = (documentXml.match(/<w:t[\s>]/g) || []).length
  const tableSignalCount = (documentXml.match(/<w:tbl[\s>]/g) || []).length

  return {
    size: stat.size,
    textSignalCount,
    tableSignalCount,
  }
}

async function convertWithLibreOffice(inputPath: string, outputPath: string) {
  const soffice = await findLibreOfficeBinary()
  if (!soffice) throw new Error('未找到 LibreOffice soffice')

  const outputDir = path.dirname(outputPath)
  await execFileAsync(soffice, [
    '--headless',
    '--convert-to',
    'docx',
    '--outdir',
    outputDir,
    inputPath,
  ], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 })

  const generatedPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.docx`)
  if (generatedPath !== outputPath) {
    await fs.rename(generatedPath, outputPath).catch(async () => {
      await fs.copyFile(generatedPath, outputPath)
      await fs.unlink(generatedPath).catch(() => {})
    })
  }
}

async function convertWithTextutil(inputPath: string, outputPath: string) {
  await execFileAsync(
    '/usr/bin/textutil',
    ['-convert', 'docx', inputPath, '-output', outputPath],
    { timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
  )
}

export async function convertLegacyWordToDocx(params: { inputPath: string; outputPath: string }) {
  const detectedFormat = await detectWordFormat(params.inputPath)
  if (detectedFormat === 'docx') {
    await fs.mkdir(path.dirname(params.outputPath), { recursive: true })
    await fs.copyFile(params.inputPath, params.outputPath)
    const validation = await validateDocx(params.outputPath)
    return { inputPath: params.inputPath, outputPath: params.outputPath, method: 'copy-docx', validation }
  }

  if (detectedFormat !== 'doc') {
    throw new Error(`仅支持将旧版 OLE Word 文件转换为 .docx，当前格式：${detectedFormat}`)
  }

  await fs.mkdir(path.dirname(params.outputPath), { recursive: true })
  await fs.unlink(params.outputPath).catch(() => {})

  const errors: string[] = []
  const methods = [
    { name: 'libreoffice', run: () => convertWithLibreOffice(params.inputPath, params.outputPath) },
    { name: 'textutil', run: () => convertWithTextutil(params.inputPath, params.outputPath) },
  ]

  for (const method of methods) {
    try {
      await fs.unlink(params.outputPath).catch(() => {})
      await method.run()
      const validation = await validateDocx(params.outputPath)
      return { inputPath: params.inputPath, outputPath: params.outputPath, method: method.name, validation }
    } catch (error) {
      errors.push(`${method.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(`Word 转换失败，已尝试 ${methods.map(method => method.name).join('、')}。${errors.join('；')}`)
}
