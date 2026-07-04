import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { DeepSeekConfig, MCPServerConfig } from '../types.js'

const CLIENT_INFO = {
  name: 'userkiller-backend',
  version: '1.0.0',
}

const MCP_REQUEST_TIMEOUT = 180000

function getWorkspaceRoot() {
  return path.resolve(process.cwd(), '..')
}

function resolveServerCwd(server: MCPServerConfig) {
  if (!server.cwd) return getWorkspaceRoot()
  if (path.isAbsolute(server.cwd)) return server.cwd
  return path.resolve(getWorkspaceRoot(), server.cwd)
}

function resolveServerEnv(server: MCPServerConfig) {
  if (!server.env) return undefined
  const entries = Object.entries(server.env).map(([key, value]) => [key, String(value)])
  return Object.fromEntries(entries)
}

export async function withMcpClient<T>(config: DeepSeekConfig, serverId: string, handler: (client: Client) => Promise<T>): Promise<T> {
  const server = config.mcpServers?.find(item => item.id === serverId)
  if (!server) {
    throw new Error(`未找到 MCP 服务配置：${serverId}`)
  }

  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd: resolveServerCwd(server),
    env: resolveServerEnv(server),
    stderr: 'pipe',
  })

  const stderrChunks: string[] = []
  const stderrStream = transport.stderr
  if (stderrStream) {
    stderrStream.on('data', chunk => {
      stderrChunks.push(String(chunk))
    })
  }

  const client = new Client(CLIENT_INFO, { capabilities: {} })

  try {
    await client.connect(transport)
    return await handler(client)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stderrOutput = stderrChunks.join('').trim()
    throw new Error(stderrOutput ? `${message}\nMCP stderr: ${stderrOutput.slice(0, 2000)}` : message)
  } finally {
    await transport.close().catch(() => undefined)
  }
}

export async function listMcpTools(config: DeepSeekConfig, serverId: string) {
  const result = await withMcpClient(config, serverId, client => client.listTools({}, { timeout: MCP_REQUEST_TIMEOUT }))
  return result.tools.map(tool => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

type MCPToolContentItem = {
  type: string
  text?: string
  resource?: {
    text?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export async function callMcpTool(config: DeepSeekConfig, params: {
  serverId: string
  toolName: string
  argumentsPayload?: Record<string, unknown>
}) {
  const result = await withMcpClient(config, params.serverId, client =>
    client.callTool({
      name: params.toolName,
      arguments: params.argumentsPayload || {},
    }, undefined, { timeout: MCP_REQUEST_TIMEOUT }),
  )

  const contentItems = Array.isArray(result.content) ? result.content as MCPToolContentItem[] : []
  const textParts = contentItems.flatMap((item: MCPToolContentItem) => {
    if (item.type === 'text' && typeof item.text === 'string') return [item.text]
    if (item.type === 'resource' && item.resource) {
      const resource = item.resource
      if (typeof resource.text === 'string') {
        return [resource.text]
      }
      return [JSON.stringify(resource)]
    }
    return [JSON.stringify(item)]
  })

  return {
    isError: result.isError === true,
    content: textParts.join('\n\n').trim(),
    raw: result,
    structuredContent: 'structuredContent' in result ? result.structuredContent : undefined,
  }
}
