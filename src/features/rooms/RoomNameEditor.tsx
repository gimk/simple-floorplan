// Inline room name editor: an HTML <input> inside a <foreignObject>, placed where the
// room name is drawn. Enter or blur commits (one undo step), Escape cancels.
import { useEffect, useRef, useState } from 'react'
import { labelPoint } from '../../model/geometry'
import { useDoc } from '../../model/store'
import type { Room } from '../../model/types'
import type { Vp } from './interaction'

export function RoomNameEditor({ room, vp, onClose }: { room: Room; vp: Vp; onClose: () => void }) {
  const [value, setValue] = useState(room.name)
  const input = useRef<HTMLInputElement>(null)
  const closed = useRef(false)

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const finish = (save: boolean) => {
    if (closed.current) return
    closed.current = true
    const name = value.trim()
    if (save && name && name !== room.name) {
      useDoc.getState().update((d) => ({
        ...d,
        rooms: d.rooms.map((r) => (r.id === room.id ? { ...r, name } : r)),
      }))
    }
    onClose()
  }

  const c = labelPoint([room.vertices, ...room.holes])
  const w = vp.px(Math.min(280, Math.max(90, room.name.length * 7 + 24)))
  const h = vp.px(26)

  return (
    <foreignObject
      x={c.x - w / 2}
      y={c.y - h * 0.78}
      width={w}
      height={h}
      className="overflow-visible"
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <input
        ref={input}
        name="roomName"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          // Tool shortcuts and the viewport listeners must stay out of the way.
          e.stopPropagation()
          if (e.key === 'Enter') { e.preventDefault(); finish(true) }
          else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
        }}
        aria-label={`Room name for ${room.code}`}
        className="box-border h-full w-full rounded-sm border border-orange-500 bg-white text-center font-semibold text-slate-800 shadow-sm outline-none dark:bg-slate-900 dark:text-slate-100"
        style={{
          fontSize: vp.px(13),
          lineHeight: 1.15,
          paddingInline: vp.px(3),
          paddingBlock: 0,
          borderWidth: vp.px(1),
        }}
      />
    </foreignObject>
  )
}
