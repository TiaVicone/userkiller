import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { callMcpTool } from './mcpService.js'
import { loadDeepSeekConfig } from '../fsUtils.js'
import type { SessionRecord } from '../types.js'

const execFileAsync = promisify(execFile)

interface SandboxConfig {
  whitelist_packages: string[]
  allowed_imports: string[]
  blocked_imports: string[]
  blocked_functions: string[]
  resource_limits: {
    max_execution_time_seconds: number
    max_memory_mb: number
    max_output_size_bytes: number
  }
  allowed_file_operations: {
    read_paths: string[]
    write_paths: string[]
    blocked_patterns: string[]
  }
}

interface SecurityViolation {
  type: 'blocked_import' | 'blocked_function' | 'dangerous_pattern' | 'path_traversal'
  line: number
  detail: string
}

export interface StaticAnalysisResult {
  safe: boolean
  violations: SecurityViolation[]
  imports: string[]
}

export interface SandboxResult {
  success: boolean
  summary: string
  data: string
  error?: string
}

let _config: SandboxConfig | null = null

function getSandboxConfig(): SandboxConfig {
  if (_config) return _config
  const configPath = path.join(process.cwd(), 'python-sandbox-config.json')
  _config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as SandboxConfig
  return _config
}

function getVenvPython(): string {
  return path.join(process.cwd(), 'python-sandbox-venv', 'bin', 'python3')
}

// Check whether the venv exists and warn if not — used on first call
let _venvWarned = false
function ensureVenvExists(): void {
  const venvPython = getVenvPython()
  if (!fs.existsSync(venvPython) && !_venvWarned) {
    _venvWarned = true
    console.warn(
      '[pythonSandbox] WARNING: sandbox venv not found at',
      venvPython,
      '— run scripts/setup-python-sandbox.sh first'
    )
  }
}

export function analyzeCodeSafety(code: string): StaticAnalysisResult {
  const config = getSandboxConfig()
  const violations: SecurityViolation[] = []
  const foundImports: string[] = []
  const lines = code.split('\n')

  // Global pattern checks (catch string concatenation bypass attempts)
  const fullCode = code.toLowerCase()
  if (/__import__/.test(code) || /importlib/.test(code)) {
    violations.push({ type: 'dangerous_pattern', line: 0, detail: '禁止使用 __import__ 或 importlib' })
  }
  if (/getattr\s*\(\s*(__builtins__|builtins)/.test(code)) {
    violations.push({ type: 'dangerous_pattern', line: 0, detail: '禁止通过 getattr 访问 builtins' })
  }
  if (/\bcompile\s*\(/.test(code) && /\bexec\s*\(/.test(code)) {
    violations.push({ type: 'dangerous_pattern', line: 0, detail: '禁止 compile+exec 组合' })
  }
  if (/_builtin_open/.test(code) || /builtins\s*\.\s*open\s*=/.test(code) || /del\s+builtins/.test(code)) {
    violations.push({ type: 'dangerous_pattern', line: 0, detail: '禁止篡改 builtins 或绕过沙箱 open' })
  }
  if (/ctypes/.test(fullCode) || /cffi/.test(fullCode)) {
    violations.push({ type: 'blocked_import', line: 0, detail: '禁止使用 ctypes/cffi' })
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    const lineNum = i + 1

    if (!line || line.startsWith('#')) continue

    // Import checks — handle both `import x` and `from x import y`
    const importMatch = line.match(/^(?:import|from)\s+([A-Za-z_][\w.]*)/)
    if (importMatch) {
      const mod = importMatch[1].split('.')[0]
      foundImports.push(mod)

      if (config.blocked_imports.includes(mod)) {
        violations.push({ type: 'blocked_import', line: lineNum, detail: `禁止导入模块 '${mod}'` })
      } else if (!config.allowed_imports.includes(mod)) {
        violations.push({ type: 'blocked_import', line: lineNum, detail: `模块 '${mod}' 不在白名单中` })
      }
    }

    // Blocked function calls
    for (const fn of config.blocked_functions) {
      const fnRegex = new RegExp(`(?<![\\w.])${fn}\\s*\\(`)
      if (fnRegex.test(line)) {
        violations.push({ type: 'blocked_function', line: lineNum, detail: `禁止使用 '${fn}()'` })
      }
    }

    // Dangerous dynamic execution patterns (broader detection)
    if (/(?<![#\w])eval\s*\(/.test(line) || /(?<![#\w])exec\s*\(/.test(line)) {
      violations.push({ type: 'dangerous_pattern', line: lineNum, detail: '禁止使用 eval()/exec()' })
    }

    // Absolute path or parent traversal in open() literals
    const openLiteralMatch = line.match(/open\s*\(\s*(['"])(.*?)\1/)
    if (openLiteralMatch) {
      const p = openLiteralMatch[2]
      if (p.startsWith('/') || p.includes('..')) {
        violations.push({ type: 'path_traversal', line: lineNum, detail: `禁止绝对路径或 .. 访问：${p}` })
      }
    }

    // Blocked path patterns in string literals
    for (const pattern of config.allowed_file_operations.blocked_patterns) {
      if (new RegExp(pattern).test(line)) {
        violations.push({ type: 'path_traversal', line: lineNum, detail: `检测到危险路径模式` })
        break
      }
    }
  }

  return { safe: violations.length === 0, violations, imports: foundImports }
}

function buildWrappedScript(
  userCode: string,
  workspacePath: string,
  outputPath: string,
  maxMemoryMb: number
): string {
  const wsSafe = workspacePath.replace(/'/g, "\\'")
  const outSafe = outputPath.replace(/'/g, "\\'")

  return [
    '# -*- coding: utf-8 -*-',
    'import os, sys',
    'try:',
    '    import resource',
    `    _mem = ${maxMemoryMb} * 1024 * 1024`,
    '    resource.setrlimit(resource.RLIMIT_AS, (_mem, _mem))',
    'except Exception:',
    '    pass',
    '',
    `WORKSPACE_PATH = os.environ.get('WORKSPACE_PATH', '${wsSafe}')`,
    `OUTPUT_PATH    = os.environ.get('OUTPUT_PATH',    '${outSafe}')`,
    '',
    '# Sandbox: intercept open() and prevent bypass',
    'import builtins as _sb_builtins',
    '_sb_original_open = _sb_builtins.open',
    'def _sb_safe_open(filename, mode="r", *args, **kwargs):',
    '    _p = os.path.realpath(str(filename))',
    '    _writing = any(c in mode for c in "wxa")',
    '    if _writing:',
    '        if not _p.startswith(os.path.realpath(OUTPUT_PATH) + os.sep) and _p != os.path.realpath(OUTPUT_PATH):',
    `            raise PermissionError(f'[sandbox] 写入仅限 OUTPUT_PATH，拒绝: {_p}')`,
    '    else:',
    '        _ws_real = os.path.realpath(WORKSPACE_PATH)',
    '        _out_real = os.path.realpath(OUTPUT_PATH)',
    '        if not (_p.startswith(_ws_real + os.sep) or _p == _ws_real or _p.startswith(_out_real + os.sep) or _p == _out_real):',
    `            raise PermissionError(f'[sandbox] 读取仅限 WORKSPACE/OUTPUT，拒绝: {_p}')`,
    '    return _sb_original_open(filename, mode, *args, **kwargs)',
    '_sb_builtins.open = _sb_safe_open',
    '',
    '# Prevent user code from restoring original open or accessing internals',
    'del _sb_original_open',
    '',
    '# Block dangerous modules at import level',
    '_sb_orig_import = _sb_builtins.__import__',
    '_sb_blocked_modules = {"subprocess", "socket", "requests", "urllib", "http.client", "ftplib", "smtplib", "ctypes", "cffi"}',
    'def _sb_restricted_import(name, *args, **kwargs):',
    '    top = name.split(".")[0]',
    '    if top in _sb_blocked_modules:',
    '        raise ImportError(f"[sandbox] 禁止导入模块: {name}")',
    '    return _sb_orig_import(name, *args, **kwargs)',
    '_sb_builtins.__import__ = _sb_restricted_import',
    '',
    '# --- user script ---',
    userCode,
  ].join('\n')
}

export async function executePythonInSandbox(
  session: SessionRecord,
  code: string,
  description: string
): Promise<SandboxResult> {
  ensureVenvExists()

  const analysis = analyzeCodeSafety(code)
  if (!analysis.safe) {
    const detail = analysis.violations.map(v => `  第 ${v.line} 行: ${v.detail}`).join('\n')
    return {
      success: false,
      summary: `安全检查失败：${description}`,
      data: `检测到 ${analysis.violations.length} 个安全问题：\n${detail}`,
      error: 'security_violation',
    }
  }

  const config = getSandboxConfig()
  const venvPython = getVenvPython()
  const tempDir = path.join(process.cwd(), 'data', 'temp', session.id)
  const scriptName = `script_${Date.now()}.py`
  const scriptPath = path.join(tempDir, scriptName)

  const deepseekConfig = await loadDeepSeekConfig()

  try {
    await callMcpTool(deepseekConfig, {
      serverId: 'filesystem',
      toolName: 'create_directory',
      argumentsPayload: { path: tempDir },
    })

    const wrapped = buildWrappedScript(
      code,
      session.workspace_path,
      session.output_path,
      config.resource_limits.max_memory_mb
    )

    await callMcpTool(deepseekConfig, {
      serverId: 'filesystem',
      toolName: 'write_file',
      argumentsPayload: { path: scriptPath, content: wrapped },
    })

    const { stdout, stderr } = await execFileAsync(venvPython, [scriptPath], {
      env: {
        WORKSPACE_PATH: session.workspace_path,
        OUTPUT_PATH: session.output_path,
        TEMP_PATH: tempDir,
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        LANG: 'en_US.UTF-8',
      },
      timeout: config.resource_limits.max_execution_time_seconds * 1000,
      cwd: session.output_path,
      maxBuffer: config.resource_limits.max_output_size_bytes,
    })

    const output = [stdout, stderr].filter(Boolean).join('\n\n').trim()
    return {
      success: true,
      summary: `Python 脚本执行成功：${description}`,
      data: output.slice(0, 4000),
    }
  } catch (error: any) {
    let msg: string
    if (error.killed || error.signal === 'SIGTERM') {
      msg = `脚本执行超时（超过 ${config.resource_limits.max_execution_time_seconds} 秒）`
    } else {
      msg = (error?.stderr || error?.stdout || error?.message || String(error)).slice(0, 4000)
    }
    return {
      success: false,
      summary: `Python 脚本执行失败：${description}`,
      data: msg,
      error: 'python_execution_failed',
    }
  } finally {
    callMcpTool(deepseekConfig, {
      serverId: 'filesystem',
      toolName: 'delete_file',
      argumentsPayload: { path: scriptPath },
    }).catch(() => {})
  }
}
