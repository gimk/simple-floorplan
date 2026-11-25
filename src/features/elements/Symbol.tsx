// Plan symbol of one element in LOCAL wall coordinates:
// x along the wall (0..width from the wall start), y toward the room interior, wall centerline at y=0.
import type { ElementKind, ElementVariant } from '../../model/types'

export const COLORS: Record<ElementKind, string> = {
  window: '#2563eb', door: '#7c3aed', opening: '#7c3aed', radiator: '#dc2626', other: '#6b7280',
}

type Props = {
  kind: ElementKind
  variant?: ElementVariant
  w: number
  t: number
  depth?: number
  hinge?: 'start' | 'end'
  swing?: 'in' | 'out'
  /** One screen pixel in cm, for hairline strokes. */
  hair: number
}

export function ElementSymbol({ kind, variant, w, t, depth, hinge = 'start', swing = 'in', hair }: Props) {
  const c = COLORS[kind]
  const h = t / 2
  const thin = Math.max(hair * 1.2, 1)
  const leaf = Math.max(hair * 2.2, 3)
  const s = swing === 'in' ? 1 : -1
  const gap = (
    <>
      <rect x={0} y={-h - 0.5} width={w} height={t + 1} className="fill-[#f6f7f5] dark:fill-[#12161b]" />
      <line x1={0} x2={0} y1={-h} y2={h} stroke={c} strokeWidth={thin} />
      <line x1={w} x2={w} y1={-h} y2={h} stroke={c} strokeWidth={thin} />
    </>
  )
  const leafArc = (hx: number, len: number, hg: 'start' | 'end') => {
    const ox = hg === 'start' ? hx + len : hx - len
    const sweep = (hg === 'start') === (s > 0) ? 1 : 0
    return (
      <>
        <line x1={hx} y1={0} x2={hx} y2={s * len} stroke={c} strokeWidth={leaf} strokeLinecap="butt" />
        <path d={`M ${ox} 0 A ${len} ${len} 0 0 ${sweep} ${hx} ${s * len}`} fill="none" stroke={c} strokeWidth={thin} strokeDasharray={`${thin * 4} ${thin * 3}`} />
      </>
    )
  }

  if (kind === 'door') {
    if (variant === 'double') {
      return <g>{gap}{leafArc(0, w / 2, 'start')}{leafArc(w, w / 2, 'end')}</g>
    }
    if (variant === 'sliding') {
      const y = t / 4
      return (
        <g>
          {gap}
          <line x1={w * 0.45} x2={w} y1={y} y2={y} stroke={c} strokeWidth={leaf} />
          <line x1={0} x2={w * 0.45} y1={-y} y2={-y} stroke={c} strokeWidth={thin} />
          <path d={`M ${w * 0.4} ${-y - t * 0.9} L ${w * 0.15} ${-y - t * 0.9} M ${w * 0.15 + 6} ${-y - t * 0.9 - 4} L ${w * 0.15} ${-y - t * 0.9} L ${w * 0.15 + 6} ${-y - t * 0.9 + 4}`} fill="none" stroke={c} strokeWidth={thin} />
        </g>
      )
    }
    if (variant === 'bifold') {
      // Two leaves per jamb, folded in a zig-zag: each leaf spans w/4 along the wall and w/4
      // into the swing side (45 degrees). The two halves meet at the middle of the opening.
      const q = w / 4
      const fold = (x0: number, dx: 1 | -1) => `M ${x0} 0 L ${x0 + dx * q} ${s * q} L ${x0 + dx * 2 * q} 0`
      return (
        <g>
          {gap}
          <line x1={0} x2={w} y1={0} y2={0} stroke={c} strokeWidth={thin} strokeDasharray={`${thin * 3} ${thin * 3}`} />
          <path d={fold(0, 1)} fill="none" stroke={c} strokeWidth={leaf} />
          <path d={fold(w, -1)} fill="none" stroke={c} strokeWidth={leaf} />
        </g>
      )
    }
    if (variant === 'pocket') {
      const x0 = hinge === 'start' ? -w : w
      return (
        <g>
          {gap}
          <line x1={0} x2={w} y1={0} y2={0} stroke={c} strokeWidth={thin} />
          <rect x={x0} y={-leaf / 2} width={w} height={leaf} fill="none" stroke={c} strokeWidth={thin} strokeDasharray={`${thin * 4} ${thin * 3}`} />
        </g>
      )
    }
    return <g>{gap}{leafArc(hinge === 'start' ? 0 : w, w, hinge)}</g>
  }

  if (kind === 'opening') {
    return (
      <g>
        {gap}
        <line x1={-h * 0.4} x2={h * 0.4} y1={-h} y2={-h} stroke={c} strokeWidth={thin} />
        <line x1={w - h * 0.4} x2={w + h * 0.4} y1={-h} y2={-h} stroke={c} strokeWidth={thin} />
        <line x1={0} x2={w} y1={0} y2={0} stroke={c} strokeWidth={thin} strokeDasharray={`${thin * 3} ${thin * 3}`} />
      </g>
    )
  }

  if (kind === 'window') {
    if (variant === 'fixed') {
      return <g>{gap}<line x1={0} x2={w} y1={0} y2={0} stroke={c} strokeWidth={leaf} /></g>
    }
    const lines = [-h * 0.7, 0, h * 0.7].map((y) => <line key={y} x1={0} x2={w} y1={y} y2={y} stroke={c} strokeWidth={thin} />)
    if (variant === 'french') {
      return <g>{gap}{lines}{leafArc(0, w / 2, 'start')}{leafArc(w, w / 2, 'end')}</g>
    }
    return <g>{gap}{lines}</g>
  }

  if (kind === 'radiator') {
    const d = depth ?? 10
    return <rect x={0} y={h} width={w} height={d} fill="#dc262622" stroke={c} strokeWidth={thin} />
  }

  return <line x1={0} x2={w} y1={0} y2={0} stroke={c} strokeWidth={leaf} />
}

/** Local y-extent (min, max) used for selection outlines and hit areas. */
export function symbolExtent(kind: ElementKind, variant: ElementVariant | undefined, w: number, t: number, depth?: number, swing: 'in' | 'out' = 'in'): [number, number] {
  const h = t / 2
  if (kind === 'radiator') return [-h, h + (depth ?? 10)]
  if (kind === 'door' && (variant === undefined || variant === 'single')) return swing === 'in' ? [-h, w] : [-w, h]
  if (kind === 'door' && variant === 'double') return swing === 'in' ? [-h, w / 2] : [-w / 2, h]
  if (kind === 'door' && variant === 'bifold') return swing === 'in' ? [-h, Math.max(w / 4, h)] : [-Math.max(w / 4, h), h]
  if (kind === 'window' && variant === 'french') return [-h, w / 2]
  return [-h, h]
}
