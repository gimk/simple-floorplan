// Make room tool (docs/walls-plan.md phase 6): click inside a closed area formed by the wall centre
// lines (the stored walls of a v2 document, the traces and room walls of a v1 document). That area
// becomes one room in ONE undo step, its name editor opens, and - in a v1 document - the traces
// that the new room walls cover are removed.
// The area under the pointer is previewed (orange), calculated at most once per frame.
import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { findEnclosingCycle } from '../../model/faces'
import { useDoc, useUi } from '../../model/store'
import type { Vec } from '../../model/types'
import { toast } from '../toast'
import { makeRoomAt } from './makeRoom'
import { docSegments } from './traces'

export function MakeRoomTool() {
  const vp = useViewport()
  const { px } = vp
  const [area, setArea] = useState<Vec[] | null>(null)
  /** Last pointer position, and the frame planned for it (one cycle search per frame). */
  const pending = useRef<Vec | null>(null)
  const frame = useRef<number | null>(null)

  const compute = () => {
    frame.current = null
    const p = pending.current
    if (!p) return
    const cycle = findEnclosingCycle(docSegments(useDoc.getState().doc), p)
    setArea(cycle ? cycle.points : null)
  }

  const onMove = (e: RPE) => {
    pending.current = vp.toWorld(e.clientX, e.clientY)
    if (frame.current === null) frame.current = requestAnimationFrame(compute)
  }

  // Leaving the tool cancels the pending frame and the preview.
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null }, [])

  const make = (e: RPE) => {
    if (e.button !== 0 || !e.isPrimary) return
    const p = vp.toWorld(e.clientX, e.clientY)
    const out = makeRoomAt(useDoc.getState().doc, p)
    if (out.kind === 'none') { toast('No closed area here'); return }
    if (out.kind === 'exists') { toast(`This area is already room ${out.room.code}`); return }
    // The room and the traces it covers change in one step: one Ctrl+Z takes both back.
    useDoc.getState().update(() => out.doc)
    const ui = useUi.getState()
    ui.select({ kind: 'room', roomId: out.roomId })
    // The name of a new room is often wrong: open the inline editor, like the rectangle tool.
    ui.set({ nameEditRoom: out.roomId })
    setArea(null)
  }

  return (
    <g>
      <CaptureRect style={{ cursor: 'pointer' }} onPointerMove={onMove} onPointerLeave={() => setArea(null)} onPointerDown={make} />
      {area && area.length >= 3 && (
        <g pointerEvents="none" data-room-preview="">
          <path d={'M' + area.map((p) => `${p.x} ${p.y}`).join('L') + 'Z'}
            className="fill-orange-500/25 stroke-orange-600 dark:stroke-orange-400" strokeWidth={px(2)} strokeDasharray={`${px(6)} ${px(4)}`} />
          <text x={area.reduce((s, p) => s + p.x, 0) / area.length} y={area.reduce((s, p) => s + p.y, 0) / area.length}
            textAnchor="middle" dominantBaseline="middle" fontSize={px(12)} fontWeight={600} paintOrder="stroke"
            strokeWidth={px(3)} strokeLinejoin="round" className="fill-orange-700 stroke-[#f6f7f5] dark:fill-orange-300 dark:stroke-[#12161b]">
            New room
          </text>
        </g>
      )}
    </g>
  )
}
