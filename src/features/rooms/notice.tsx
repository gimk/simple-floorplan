// Short on-canvas message (e.g. "Room would cross itself"). Rendered inside the world <g>.
import { create } from 'zustand'
import { useViewport } from '../../canvas/Viewport'
import type { Vec } from '../../model/types'

export const useNotice = create<{ text: string; at: Vec | null }>()(() => ({ text: '', at: null }))

let timer: ReturnType<typeof setTimeout> | undefined

export function notify(text: string, at: Vec) {
  useNotice.setState({ text, at })
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => useNotice.setState({ text: '', at: null }), 2800)
}

export function NoticeLayer() {
  const n = useNotice()
  const { px } = useViewport()
  if (!n.at) return null
  return (
    <text x={n.at.x} y={n.at.y - px(22)} textAnchor="middle" fontSize={px(13)} fontWeight={600} pointerEvents="none"
      paintOrder="stroke" strokeWidth={px(4)} strokeLinejoin="round"
      className="fill-red-600 stroke-[#f6f7f5] dark:fill-red-400 dark:stroke-[#12161b]">
      {n.text}
    </text>
  )
}
