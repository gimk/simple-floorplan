import type { PlanDocV1 } from '../../src/core/schema'

export type JsonRpcId = string | number | null

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

export type JsonRpcError = {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: JsonRpcError }

export type McpTextContent = {
  type: 'text'
  text: string
}

export type McpResourceLinkContent = {
  type: 'resource_link'
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export type McpContentItem = McpTextContent | McpResourceLinkContent

export type McpToolResult = {
  content: McpContentItem[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export type McpToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpResource = {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export type McpResourceTemplate = {
  uriTemplate: string
  name: string
  description?: string
  mimeType?: string
}

export type McpResourceContent = {
  uri: string
  mimeType?: string
  text: string
}

export type McpPromptArgument = {
  name: string
  description?: string
  required?: boolean
}

export type McpPromptDefinition = {
  name: string
  description: string
  arguments?: McpPromptArgument[]
}

export type McpPromptMessage = {
  role: 'user' | 'assistant'
  content: McpTextContent
}

export type ProjectSummaryRow = {
  id: string
  name: string
  title: string | null
  updatedAt: string
}

export type LoadedProject = {
  project: ProjectSummaryRow
  doc: PlanDocV1
  version: number
}

export type ProjectEvent = {
  id: string
  projectId: string
  ts: string
  actor: string
  kind: string
  summary: string
  payload: unknown
}

/**
 * Optional per-request context passed from the HTTP route into the dispatcher:
 * who is calling (actor/scopes for in-tool scope enforcement) and how to append
 * to the project event log after a successful write.
 */
export type McpCallContext = {
  actor: string
  scopes: string[]
  /** Token project restriction (null = all projects). */
  projectId: string | null
  /** Append one event per executed command (kind "command"), like the commands route. */
  logCommandEvents?(projectId: string, commands: { type: string }[], results: unknown[]): Promise<void>
  /** Append a single non-command event (e.g. project_create). */
  logEvent?(projectId: string, kind: string, summary: string, payload: Record<string, unknown>): Promise<void>
}

export interface McpStore {
  listProjects(): Promise<ProjectSummaryRow[]>
  createProject(input: { name: string; title?: string | null }): Promise<ProjectSummaryRow>
  loadProject(id: string): Promise<LoadedProject | null>
  commitDoc(id: string, prev: LoadedProject, nextDoc: PlanDocV1): Promise<{ version: number; updatedAt: string }>
  listEvents(projectId: string, since?: string, limit?: number): Promise<ProjectEvent[]>
  getBackgroundHref(doc: PlanDocV1): Promise<string | undefined>
}
