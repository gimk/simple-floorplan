// Reference images in world space (background layer). Plan mode + unlocked: click selects, drag moves,
// corner handles resize proportionally. Design mode: non-interactive.
import { memo, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useDoc } from '../../model/store'
import { useUi } from '../../shell/uiStore'
import { useViewport } from '../../canvas/Viewport'
import { resizeFromCorner, cornerPx } from './scale'
import type { RefImage } from '../../model/types'
import { CANVAS_SELECT_DEEP } from '../../shell/canvasTokens'
import { MAX_DISPLAY_PX, displayCacheVersion, getCachedDisplay, needsDownscale, requestDisplay, subscribeDisplayCache } from './displayCache'

type Drag =
  | { kind: 'move'; id: string; start: { x: number; y: number }; x0: number; y0: number }
  | { kind: 'corner'; id: string; corner: number }

function RefImagesLayerImpl() {
  const refImages = useDoc((s) => s.doc.refImages)
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const selection = useUi((s) => s.selection)
  const { toWorld, px, zoom } = useViewport()
  useSyncExternalStore(subscribeDisplayCache, displayCacheVersion)
  const drag = useRef<Drag | null>(null)
  const interactive = mode === 'plan' && tool === 'select'
  const visibleImages = useMemo(() => refImages.filter((i) => i.visible), [refImages])

  // Kick off one-time downscale for large images (display only; doc src is never changed).
  useEffect(() => {
    for (const i of visibleImages) {
      if (needsDownscale(i.naturalWidth, i.naturalHeight)) void requestDisplay(i.src)
    }
  }, [visibleImages])

  const onDown = (e: React.PointerEvent, img: RefImage) => {
    if (!interactive || e.button !== 0) return
    e.stopPropagation()
    useUi.getState().set({ selection: { kind: 'refImage', imageId: img.id } })
    if (img.locked) return
    const w = toWorld(e.clientX, e.clientY)
    drag.current = { kind: 'move', id: img.id, start: w, x0: img.xCm, y0: img.yCm }
    useDoc.getState().beginDrag()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onCornerDown = (e: React.PointerEvent, img: RefImage, corner: number) => {
    if (e.button !== 0) return
    e.stopPropagation()
    drag.current = { kind: 'corner', id: img.id, corner }
    useDoc.getState().beginDrag()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const w = toWorld(e.clientX, e.clientY)
    useDoc.getState().updateSilent((doc) => {
      const im = doc.refImages.find((r) => r.id === d.id)
      if (!im) return
      if (d.kind === 'move') {
        im.xCm = d.x0 + (w.x - d.start.x)
        im.yCm = d.y0 + (w.y - d.start.y)
      } else {
        Object.assign(im, resizeFromCorner(im, d.corner, w))
      }
    })
  }
  const onUp = (e: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    useDoc.getState().endDrag()
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
  }

  return (
    <g data-testid="ref-images-layer" style={{ pointerEvents: interactive ? undefined : 'none' }}>
      {visibleImages.map((img) => {
        const w = img.naturalWidth * img.cmPerPx, h = img.naturalHeight * img.cmPerPx
        const cx = img.xCm + w / 2, cy = img.yCm + h / 2
        const selected = selection.kind === 'refImage' && selection.imageId === img.id
        const canEdit = interactive && !img.locked
        const onScreen = Math.max(w, h) * zoom
        const lowRes = needsDownscale(img.naturalWidth, img.naturalHeight) && onScreen <= MAX_DISPLAY_PX
          ? getCachedDisplay(img.src) : undefined
        return (
          <g key={img.id} transform={`rotate(${img.rotationDeg} ${cx} ${cy})`}>
            <image
              data-testid={`ref-image-${img.id}`}
              href={lowRes ?? img.src}
              x={img.xCm} y={img.yCm} width={w} height={h}
              preserveAspectRatio="none"
              opacity={img.opacity}
              style={{ pointerEvents: interactive ? 'auto' : 'none', cursor: canEdit ? 'move' : undefined }}
              onPointerDown={(e) => onDown(e, img)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
            {interactive && selected && (
              <rect x={img.xCm} y={img.yCm} width={w} height={h} fill="none" stroke={CANVAS_SELECT_DEEP} strokeWidth={px(1.5)} pointerEvents="none" />
            )}
            {canEdit && selected && [0, 1, 2, 3].map((i) => {
              const c = cornerPx(img, i)
              const wc = { x: img.xCm + c.x * img.cmPerPx, y: img.yCm + c.y * img.cmPerPx }
              const s = px(10)
              return (
                <rect
                  key={i}
                  data-testid={`ref-handle-${i}`}
                  x={wc.x - s / 2} y={wc.y - s / 2} width={s} height={s}
                  fill="#fff" stroke={CANVAS_SELECT_DEEP} strokeWidth={px(1.5)}
                  style={{ cursor: i % 2 === 0 ? 'nwse-resize' : 'nesw-resize' }}
                  onPointerDown={(e) => onCornerDown(e, img, i)}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                />
              )
            })}
          </g>
        )
      })}
    </g>
  )
}

export const RefImagesLayer = memo(RefImagesLayerImpl)
