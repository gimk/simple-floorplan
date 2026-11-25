import { useState } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { dot, sub, type Wall } from '../../model/geometry'
import { useDoc, useUi } from '../../model/store'
import type { Room } from '../../model/types'
import { nearestWall, wallThickness } from '../elements/geometry'
import { toast } from '../toast'
import { storageCorners, wallRunMetrics, type WallRunMetrics } from './geometry'
import { DEFAULT_STORAGE_DOOR, DEFAULT_STORAGE_PARAMS, hostWallIdForRoomWall, storageOffsetFromClick } from './ui'

type StorageHover = {
  room: Room
  wall: Wall
  metrics: WallRunMetrics
  offsetCm: number
}

/** Tool overlay for `ui.tool === 'place-storage'`: click a room wall to add built-in storage. */
export function PlaceStorageTool() {
  const { px, toWorld } = useViewport()
  const [hover, setHover] = useState<StorageHover | null>(null)

  const compute = (clientX: number, clientY: number): StorageHover | null => {
    const p = toWorld(clientX, clientY)
    const rooms = useDoc.getState().doc.rooms.filter((r) => !r.storage)
    const hit = nearestWall(rooms, p, px(30))
    if (!hit) return null
    const metrics = wallRunMetrics(hit.room, hit.wall.index)
    if (!metrics) return null
    const alongFromRun = dot(sub(hit.wall.start, metrics.startCentre), metrics.dir) + hit.along
    const offsetCm = storageOffsetFromClick(
      alongFromRun - metrics.cornerInset,
      DEFAULT_STORAGE_PARAMS.widthCm,
      metrics.innerLength,
    )
    return { room: hit.room, wall: hit.wall, metrics, offsetCm }
  }

  const onMove = (e: React.PointerEvent) => setHover(compute(e.clientX, e.clientY))

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const h = compute(e.clientX, e.clientY)
    if (!h) { setHover(null); return }
    e.stopPropagation()
    const doc = useDoc.getState().doc
    const hostWall = hostWallIdForRoomWall(doc, h.room, h.wall.start.id)
    const params = { ...DEFAULT_STORAGE_PARAMS, offsetCm: h.offsetCm }
    const res = useDoc.getState().addStorage(h.room.id, hostWall, params, DEFAULT_STORAGE_DOOR)
    if ('error' in res) {
      toast(res.error)
      return
    }
    useUi.getState().select({ kind: 'room', roomId: res.storageRoomId })
  }

  const preview = hover
    ? storageCorners(
        hover.metrics.startCentre,
        hover.metrics.endCentre,
        hover.wall.inward,
        wallThickness(hover.room, hover.wall.start.id),
        { ...DEFAULT_STORAGE_PARAMS, offsetCm: hover.offsetCm },
        hover.metrics.cornerInset,
      )
    : null

  return (
    <g>
      <CaptureRect
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerLeave={() => setHover(null)}
        style={{ cursor: 'crosshair' }}
      />
      {preview && (
        // A light preview: the tool overlay is drawn ABOVE the dimension layers, so a strong orange
        // box hid the outside dimension number under it (UI test report docs/ui-test-report-storage.md,
        // "Look": the preview of the 'g' tool over the '410' of the outside row). About 25 % of
        // fill, a thin stroke, no hatch: the value below stays readable.
        <polygon
          points={[preview.A, preview.B, preview.C, preview.D].map((pt) => `${pt.x},${pt.y}`).join(' ')}
          className="fill-amber-200/25 stroke-orange-600/70 dark:fill-amber-700/25 dark:stroke-orange-400/70"
          strokeWidth={px(1.5)}
          strokeDasharray={`${px(5)} ${px(4)}`}
          pointerEvents="none"
          data-storage-preview=""
        />
      )}
    </g>
  )
}
