import { renderPlanSvg } from '../../src/core/export'
import { querySummary, queryUnmeasured } from '../../src/core/queries'
import type { McpResource, McpResourceContent, McpResourceTemplate, McpStore } from './types'

export const MCP_RESOURCES: McpResource[] = [
  {
    uri: 'floorplan://projects',
    name: 'Projects list',
    description: 'JSON list of all floorplan projects with IDs, names, titles, and timestamps.',
    mimeType: 'application/json',
  },
]

export const MCP_RESOURCE_TEMPLATES: McpResourceTemplate[] = [
  {
    uriTemplate: 'floorplan://projects/{id}/plan.json',
    name: 'Project PlanDoc JSON',
    description: 'Full PlanDoc v1 JSON document (rooms, walls, elements, measurements, notes, version).',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'floorplan://projects/{id}/summary.json',
    name: 'Project Summary JSON',
    description: 'Rooms, indoor/outdoor areas, survey progress, and paint/flooring/baseboard takeoff.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'floorplan://projects/{id}/unmeasured.json',
    name: 'Unmeasured Survey IDs JSON',
    description: 'Remaining unmeasured walls, diagonals, and ceiling heights in walking order.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'floorplan://projects/{id}/render.svg',
    name: 'Floorplan SVG Render',
    description: 'Standalone vector SVG render of the floorplan with room labels, wall types, openings, and scale bar.',
    mimeType: 'image/svg+xml',
  },
  {
    uriTemplate: 'floorplan://projects/{id}/events.json',
    name: 'Project Event Log JSON',
    description: 'Append-only event log: one event per write route and one per command in a batch (including MCP tool writes).',
    mimeType: 'application/json',
  },
]

export class ResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResourceNotFoundError'
  }
}

export async function readResource(store: McpStore, uri: string): Promise<McpResourceContent> {
  if (uri === 'floorplan://projects') {
    const projects = await store.listProjects()
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ projects }, null, 2),
    }
  }

  const match = /^floorplan:\/\/projects\/([^/]+)\/(plan\.json|summary\.json|unmeasured\.json|render\.svg|events\.json)$/.exec(uri)
  if (!match) {
    throw new ResourceNotFoundError(`Unknown resource URI: ${uri}`)
  }

  const projectId = decodeURIComponent(match[1])
  const kind = match[2]
  const loaded = await store.loadProject(projectId)
  if (!loaded) {
    throw new ResourceNotFoundError(`Project not found: ${projectId}`)
  }

  if (kind === 'plan.json') {
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ ...loaded.doc, version: loaded.version }, null, 2),
    }
  }

  if (kind === 'summary.json') {
    const summary = querySummary(loaded.doc)
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ ...summary, version: loaded.version }, null, 2),
    }
  }

  if (kind === 'unmeasured.json') {
    const unmeasured = queryUnmeasured(loaded.doc)
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(unmeasured, null, 2),
    }
  }

  if (kind === 'events.json') {
    const events = await store.listEvents(projectId)
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ projectId, events }, null, 2),
    }
  }

  // render.svg
  const { svg } = renderPlanSvg(loaded.doc, { background: false })
  return {
    uri,
    mimeType: 'image/svg+xml',
    text: svg,
  }
}
