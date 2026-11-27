import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject } from '../model/schema'
import { useDoc } from '../model/store'
import { useUi } from '../shell/uiStore'
import { createAgentBridge, type SfpAgentBridge } from './bridge'
import { registerWebMcpTools, type WebMcpTool } from './webmcp'

let bridge: SfpAgentBridge
const rect = { type: 'add_room_rect', name: 'Kitchen', xCm: 0, yCm: 0, widthCm: 400, heightCm: 300 } as const

beforeEach(() => {
  useDoc.getState().hydrate(createDefaultProject())
  useUi.getState().set({ mode: 'plan', tool: 'select', activeArtboardId: null, selection: { kind: 'none' } })
  bridge = createAgentBridge()
})
afterEach(() => { vi.unstubAllGlobals() })

const roomCount = () => bridge.getDoc().artboards.reduce((n, a) => n + a.rooms.length, 0)

describe('createAgentBridge', () => {
  it('has version 3 and returns a deep clone from getDoc', () => {
    expect(bridge.version).toBe('3')
    const d = bridge.getDoc()
    d.title = 'changed'
    expect(bridge.getDoc().title).not.toBe('changed')
  })

  it('exec applies a command as one undo step; undo/redo work', () => {
    const r = bridge.exec(rect)
    expect(r.ok).toBe(true)
    expect(roomCount()).toBe(1)
    expect(bridge.undo()).toBe(true)
    expect(roomCount()).toBe(0)
    expect(bridge.redo()).toBe(true)
    expect(roomCount()).toBe(1)
    expect(bridge.redo()).toBe(false)
  })

  it('exec of a batch is one undo step', () => {
    bridge.exec([rect, { ...rect, name: 'Bath', xCm: 500 }])
    expect(roomCount()).toBe(2)
    bridge.undo()
    expect(roomCount()).toBe(0)
  })

  it('dryRun does not change the doc', () => {
    const r = bridge.dryRun(rect)
    expect(r).toMatchObject({ ok: true, dryRun: true })
    expect(roomCount()).toBe(0)
    expect(bridge.undo()).toBe(false)
  })

  it('exec reports errors without changing the doc', () => {
    const r = bridge.exec({ type: 'delete_artboard', artboardId: 'nope' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('delete_artboard')
    expect(roomCount()).toBe(0)
  })

  it('summarize and validate', () => {
    bridge.exec(rect)
    expect(bridge.summarize().artboards[0].rooms).toHaveLength(1)
    expect(bridge.validate().ok).toBe(true)
  })

  it('exportProject and loadProject round-trip; bad input is refused', () => {
    bridge.exec(rect)
    const text = bridge.exportProject()
    expect(JSON.parse(text).schemaVersion).toBe(3)
    useDoc.getState().hydrate(createDefaultProject())
    expect(bridge.loadProject(JSON.parse(text))).toMatchObject({ ok: true })
    expect(roomCount()).toBe(1)
    expect(bridge.undo()).toBe(false) // history cleared
    const bad = bridge.loadProject({ schemaVersion: 3 })
    expect(bad.ok).toBe(false)
    expect(bad.issues?.length).toBeGreaterThan(0)
    expect(roomCount()).toBe(1)
  })

  it('exportSvg renders an artboard', () => {
    bridge.exec(rect)
    const r = bridge.exportSvg()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.svg).toContain('<svg')
    expect(bridge.exportSvg('missing').ok).toBe(false)
  })

  it('setMode, setTool, select, setActiveArtboard, setView', () => {
    bridge.setMode('design')
    bridge.setTool('tape')
    bridge.select({ kind: 'refImage', imageId: 'x' })
    const id = bridge.getDoc().artboards[0].id
    expect(bridge.setActiveArtboard(id)).toBe(true)
    expect(bridge.setActiveArtboard('missing')).toBe(false)
    bridge.setView({ x: 10, y: 20, zoom: 2 })
    bridge.setView({ x: 1, y: 1, zoom: 0 }) // ignored
    expect(bridge.getUi()).toEqual({ mode: 'design', tool: 'tape', activeArtboardId: id, selection: { kind: 'refImage', imageId: 'x' }, view: { x: 10, y: 20, zoom: 2 } })
  })

  it('worldToScreen and screenToWorld return null without a canvas', () => {
    expect(bridge.worldToScreen(0, 0)).toBeNull()
    expect(bridge.screenToWorld(0, 0)).toBeNull()
  })

  it('worldToScreen and screenToWorld use the canvas rect and view', () => {
    vi.stubGlobal('document', { querySelector: () => ({ getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }) }) })
    bridge.setView({ x: 10, y: 20, zoom: 2 })
    const s = bridge.worldToScreen(30, 40)
    expect(s).toEqual({ x: 140, y: 90 })
    expect(bridge.screenToWorld(140, 90)).toEqual({ xCm: 30, yCm: 40 })
  })

  it('subscribe gets monotonic revs and can unsubscribe', () => {
    const revs: number[] = []
    const off = bridge.subscribe((e) => revs.push(e.rev))
    bridge.exec(rect)
    bridge.undo()
    expect(revs).toEqual([1, 2])
    off()
    bridge.redo()
    expect(revs).toEqual([1, 2])
  })
})

describe('registerWebMcpTools', () => {
  it('does nothing without navigator.modelContext', () => {
    vi.stubGlobal('navigator', {})
    expect(() => registerWebMcpTools(bridge)()).not.toThrow()
  })

  it('registers the tools and runs them', async () => {
    const tools = new Map<string, WebMcpTool>()
    const unregister = vi.fn()
    vi.stubGlobal('navigator', { modelContext: { registerTool: (t: WebMcpTool) => { tools.set(t.name, t); return { unregister } } } })
    const cleanup = registerWebMcpTools(bridge)
    expect([...tools.keys()].sort()).toEqual(['sfp_exec', 'sfp_export_svg', 'sfp_get_doc', 'sfp_get_project', 'sfp_load_project', 'sfp_redo', 'sfp_set_ui', 'sfp_undo', 'sfp_validate'])
    for (const t of tools.values()) expect(t.inputSchema.type).toBe('object')
    const run = async (name: string, input: Record<string, unknown> = {}) => {
      const r = await tools.get(name)!.execute(input)
      return { isError: r.isError, data: JSON.parse(r.content[0].text) }
    }
    expect((await run('sfp_exec', { commands: rect, dryRun: true })).data).toMatchObject({ ok: true, dryRun: true })
    expect(roomCount()).toBe(0)
    expect((await run('sfp_exec', { commands: [rect] })).data.ok).toBe(true)
    expect(roomCount()).toBe(1)
    const bad = await run('sfp_exec', { commands: { type: 'delete_artboard', artboardId: 'nope' } })
    expect(bad.isError).toBe(true)
    expect((await run('sfp_get_project')).data.summary.artboards).toHaveLength(1)
    expect((await run('sfp_get_doc')).data.schemaVersion).toBe(3)
    expect((await run('sfp_validate')).data.ok).toBe(true)
    expect((await run('sfp_export_svg')).data.ok).toBe(true)
    expect((await run('sfp_set_ui', { mode: 'design', tool: 'rect' })).data.ui).toMatchObject({ mode: 'design', tool: 'rect' })
    expect((await run('sfp_undo')).data).toEqual({ changed: true })
    expect((await run('sfp_redo')).data).toEqual({ changed: true })
    expect((await run('sfp_load_project', { project: { nope: 1 } })).isError).toBe(true)
    cleanup()
    expect(unregister).toHaveBeenCalledTimes(9)
  })
})
