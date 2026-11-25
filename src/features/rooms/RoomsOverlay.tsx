// The overlays of the plan: every part of the room layer that must stay ABOVE the walls of the
// wall graph (docs/walls-plan.md, "Walls in the interface").
//
// A wall band is an opaque shape, so a room label, a dimension text, a wall number badge, a hover
// highlight, the side lines of the selected wall or the inline room name editor drawn UNDER the
// bands would be hidden (UI review F1). The app draws this layer after WallsLayer, so the bands
// never cover them. Only the room floors, the hole hit areas and the walls of a v1 document stay
// under the walls (features/rooms/RoomsLayer.tsx).
import { useMemo } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { dist, fmtCm, innerWallLengths, labelPoint, roomInnerRing, roomWalls } from '../../model/geometry'
import { surveyIds } from '../../model/survey'
import { fitsPlan, measuredBreakdown, measuredTextIn, shownLength } from '../../model/precision'
import { fmtLen, unitSuffix } from '../../model/units'
import { useDoc, useUi } from '../../model/store'
import type { Vec } from '../../model/types'
import { outlinePerimeterCm, roomPerimeterCm, roomTagLines, tagCeilingCm, wallProgress, type RoomTagLines } from './roomTag'
import { onRoomDown } from './interaction'
import { RoomNameEditor } from './RoomNameEditor'
import { useRoomsFrame } from './RoomsLayer'
import { wallProps } from './walls'
import { wallAppearance } from '../renovation/logic'
import { wallAlignOffsetCm, sideFaceKeys, storedWallView } from './wallSides'
import { isV2Doc } from '../../model/v2/targets'
import { useIsDesktop } from '../../shell/useDesktop'
import { DIM_STYLE, dimLine, dimLineOfSpan, worldPx, type DimLine } from './dims/dimLine'
import { DimLineView, valueFill } from './dims/DimLineView'
import { MISMATCH_FILL } from '../../shell/panel/styles'
import { useValueStates } from './dims/useValueStates'
import type { ValueState } from '../solver/lookup'
import { SolverGhostLayer } from './SolverGhostLayer'
import { fittingRows, pickWallBadge, ringBox, tagBox, textBox, textQuad, wallBadgePlaces, type Box } from './dims/dimBoxes'
import { storageLabelCentre, storageLabelFits, storageLabelSize } from './dims/storageLabel'
import { DECLUTTER, keepDimTexts, smallRoomDims } from './dims/declutter'
import { outsideDimTextBoxes } from './dims/outsideTextBoxes'
import { outsideDims, outsideDimsLod } from './outside/outsideDims'
import { DimEditor } from './dims/DimEditor'
import { dimEditAllowed, dimTextLabel, parseRoomWallLabel, stepRoomWallLabel, useDimEdit, type DimEditOpen, type DimEditorStep } from './dims/dimEdit'

/** A wall number badge, in the colours of a selected wall, or of a normal one. */
const badgeClass = {
  strong: 'fill-orange-500 stroke-orange-700 dark:stroke-orange-300',
  weak: 'fill-orange-200 stroke-orange-500 dark:stroke-orange-400',
  none: 'fill-white/90 stroke-slate-400 dark:fill-slate-800/95 dark:stroke-slate-500',
}

const badgeTextClass = {
  strong: 'fill-white',
  weak: 'fill-orange-900',
  none: 'fill-slate-600 dark:fill-slate-300',
}

export function RoomsOverlay() {
  const f = useRoomsFrame()
  const {
    rooms, selection, layers, renovationView, showCodes, showWallNumbers, measurements, storedWalls, storedNodes,
    hover, hoverWall, hoverLabel, step, display, vp, px, zoom, labelAt, interactive, selRoomIds, selWalls,
    selStoredWall, editing, setEditing, closeEditor, forcedWalls,
  } = f

  /** Wall lengths: dimension lines (default) or the old text only (docs/measurements-plan.md). */
  const dimStyle = useUi((s) => s.dimStyle)
  /**
   * State of every length text of the plan, green measured / purple solved / grey estimated
   * (docs/solver-plan.md): one memoized lookup per document, not one pass per text node.
   */
  const valueStates = useValueStates()
  /** Units of the lengths written on the plan (docs/measurements-plan.md section 5). */
  const units = useUi((s) => s.canvasUnits)
  /** Only Edit mode with the Select tool types a length on the plan (section 4). */
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  /** True when a double-click on a dimension text opens its field. */
  const canEditDims = dimEditAllowed(mode, tool) && interactive
  /** Label of the dimension text whose field is open: the field replaces that text. */
  const dimEditing = useDimEdit((s) => s.edit?.label ?? null)

  /** Rows of the room tag chosen in the View menu (docs/measurements-plan.md section 2). */
  const tag = useUi((s) => s.roomTag)
  /** A v2 document has the outside dimension chains, which the badges must also keep off (R2-2). */
  const isV2 = useDoc((s) => isV2Doc(s.doc))
  /** The outside chains are hidden in Measuring Mode on a phone (see outside/OutsideDimsLayer.tsx). */
  const isDesktop = useIsDesktop()
  // Rooms without their own height use the apartment default height.
  const defaultCeilingCm = useDoc((s) => s.doc.apartment?.defaultCeilingCm)
  const tagInput = (d: (typeof display)[number]) => {
    const members = rooms.filter((r) => d.roomIds.includes(r.id))
    const progress = wallProgress(members, measurements)
    return {
      name: d.name, codes: d.codes, areaM2: d.areaM2,
      // A single room is measured on its inside faces, like the wall lengths; a group merged in the
      // After view has one outline, so its perimeter is the one of that outline.
      perimeterCm: d.merged ? outlinePerimeterCm(d.pieces) : members[0] ? roomPerimeterCm(members[0]) : 0,
      ceilingCm: tagCeilingCm(members.map((r) => (r.ceilingCm ? r : { ...r, ceilingCm: defaultCeilingCm }))),
      measuredWalls: progress.measured, walls: progress.walls,
    }
  }

  /**
   * The tag of each room on the plan (r1fix R1-8): where it goes, its lines, the rows that FIT in
   * the room (rows are dropped from the end when the box does not fit), and its box, which the wall
   * dimension texts keep out of.
   */
  type TagInfo = {
    place: { p: Vec; vertical: boolean }
    lines: RoomTagLines
    rows: string[]
    /** Box of the tag on the plan, cm; null for a room too small for a tag. */
    box: Box | null
    /** Too small on screen for the name: the code alone is drawn. */
    small: boolean
    /** Not drawn at all: the label of a storage that a wall number badge would touch. */
    hide: boolean
  }
  const tags = new Map<string, TagInfo>()
  /** Box of the tag of every room of a group, by room id: the wall dimensions of a room avoid it. */
  const tagBoxInRoom = new Map<string, Box>()
  for (const d of display) {
    const ring = d.pieces[0]?.[0] ?? []
    if (ring.length < 3) continue
    const members = rooms.filter((r) => d.roomIds.includes(r.id))
    const inner = !d.merged && members[0] ? roomInnerRing(members[0]) : ring
    // A built-in storage is a small room outside its parent: its label goes at the CENTRE of its
    // inside ring, it keeps its name alone when the full tag would touch a wall number badge of its
    // own walls, and it is dropped when even the name is too wide (UI test report
    // docs/ui-test-report-storage.md, "Look": the badge '3' sat on the end of the small "Storage"
    // label). The hatch and the walls of the storage stay.
    const isStorageRoom = !d.merged && !!members[0]?.storage
    const place = isStorageRoom
      ? { p: storageLabelCentre(inner), vertical: false }
      : labelAt.get(d.id) ?? { p: labelPoint(d.pieces[0]), vertical: false }
    /** True when the name of a storage alone fits in its ring, clear of the badges; other rooms pass. */
    const nameFits = () => {
      if (!isStorageRoom) return true
      const nameSize = storageLabelSize(d.name, zoom)
      return storageLabelFits(inner, nameSize.w, nameSize.h, zoom)
    }
    const lines = roomTagLines(tagInput(d), tag, { showCodes })
    const xs = ring.map((v) => v.x), ys = ring.map((v) => v.y)
    const small = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * zoom < 50
    if (small) {
      tags.set(d.id, { place, lines, rows: [], box: null, small: true, hide: !nameFits() })
      continue
    }
    // The inside box of the room: a tag may not stick out of it (a small room keeps fewer rows).
    const size = labelAt.get(d.id)?.size ?? ((count: number) => ({ w: 0, h: count }))
    const rows = fittingRows(lines.rows, { p: place.p, vertical: place.vertical, size, room: ringBox(inner) })
    const kept = size(rows.length)
    const box = tagBox(place.p, kept.w, kept.h, place.vertical)
    if (isStorageRoom && !storageLabelFits(inner, kept.w, kept.h, zoom)) {
      // No room for the tag and a badge beside it: the name alone, or nothing (keep the hatch).
      tags.set(d.id, { place, lines, rows: [], box: null, small: true, hide: !nameFits() })
      continue
    }
    tags.set(d.id, { place, lines: { title: lines.title, rows }, rows, box, small: false, hide: false })
    for (const id of d.roomIds) tagBoxInRoom.set(id, box)
  }

  const label = (d: (typeof display)[number]) => {
    // The room being renamed shows the inline editor instead (drawn last, above the hit areas).
    if (!d.merged && editing === d.id) return null
    const info = tags.get(d.id)
    if (!info) return null
    // A storage whose label a wall number badge would touch shows its hatch only (UI test report
    // docs/ui-test-report-storage.md, "Look").
    if (info.hide) return null
    const lines = info.lines
    // Room code in front of the name, so the survey IDs of the Solve tab are found on the plan.
    const code = lines.title.code ?? ''
    const isStorage = !d.merged && rooms.some((r) => r.id === d.id && r.storage)
    if (info.small) {
      // No room for the full tag: storage rooms show their name ("Storage") small; other rooms show their code.
      const smallText = isStorage ? d.name : code
      if (!smallText) return null
      const p = info.place.p
      return (
        <text key={d.id} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize={px(10)}
          fontWeight={isStorage ? 600 : 700} pointerEvents="none" data-room-code-only={d.id}
          className={isStorage ? 'fill-slate-600 dark:fill-slate-300' : 'fill-slate-500 font-mono dark:fill-slate-400'}>
          {smallText}
        </text>
      )
    }
    const place = info.place
    // One line for the title and one per row, the whole block centred on the point: the baseline of
    // the title sits half the block above it, less the ascender of its 14 px line.
    const rowStep = px(15)
    const blockH = px(14) + lines.rows.length * rowStep
    const c = { x: place.p.x, y: place.p.y - blockH / 2 + px(11) }
    return (
      <text key={d.id} x={c.x} y={c.y} textAnchor="middle" data-label-vertical={place.vertical ? '' : undefined}
        transform={place.vertical ? `rotate(-90 ${place.p.x} ${place.p.y})` : undefined} pointerEvents={interactive ? 'auto' : 'none'}
        className="fill-slate-800 dark:fill-slate-100" fontSize={px(14)}>
        <tspan x={c.x} fontWeight={600} data-room-label={d.id} style={interactive ? { cursor: 'text' } : undefined}
          onPointerDown={interactive ? (e) => onRoomDown(e, d.id, vp) : undefined}
          onDoubleClick={interactive && !d.merged ? (e) => { e.stopPropagation(); setEditing(d.id) } : undefined}>
          {code !== '' && (
            <tspan fontWeight={700} className="font-mono" data-room-code-text={d.codes[0]}>{`${code}  `}</tspan>
          )}
          {lines.title.name}
        </tspan>
        {lines.rows.map((row, i) => (
          <tspan key={`row${i}`} x={c.x} dy={rowStep} fontSize={px(12)} pointerEvents="none"
            data-room-tag-row={i} className="fill-slate-500 dark:fill-slate-400">
            {row}
          </tspan>
        ))}
      </text>
    )
  }

  /** The faces of both sides of the selected stored wall, for its helper dimensions. */
  const selWallView = useMemo(
    () => (selStoredWall
      ? storedWallView({ rooms, nodes: storedNodes, walls: storedWalls, measurements }, selStoredWall.wallId)
      : null),
    [selStoredWall, rooms, storedNodes, storedWalls, measurements],
  )

  /**
   * Room walls whose dimension line is hidden because the helper dimensions of the selected wall
   * already show the same length (r1fix R1-4 note, suggestion 6): a face of that wall.
   */
  const hiddenDimFaces = new Set<string>()
  if (selStoredWall && layers.dimensions) {
    for (const s of selWallView?.sides ?? []) {
      for (const face of s.faces) {
        if (face.kind === 'room' && face.wallStart) hiddenDimFaces.add(`${face.roomId}:${face.wallStart}`)
      }
    }
  }

  /**
   * Where the field of a typed length opens, for each dimension text of the plan that writes a
   * room face: Tab / Shift+Tab then goes to the next / previous wall of the same room.
   */
  const dimPlaces = new Map<string, DimEditOpen>()

  /** Open the small field on one dimension text (docs/measurements-plan.md section 4). */
  const openDim = (label: string, at: Vec, plannedCm: number, room?: (typeof rooms)[number]) => {
    const faces = room ? roomWalls(room).length : undefined
    useDimEdit.getState().open({ label, at, plannedCm, roomCode: room?.code, faces })
  }

  /** Tab / Shift+Tab of the field: the next / previous wall of the room, when it has a text. */
  const stepDim: DimEditorStep = (from, delta) => {
    if (from.roomCode === undefined || from.faces === undefined) return null
    const next = stepRoomWallLabel(from.label, delta, from.faces)
    return next ? dimPlaces.get(next) ?? null : null
  }

  /** The side lines of the selected stored wall, and its A / B markers. */
  const selectedWallSide = (() => {
    if (!selStoredWall) return null
    const { a, b, thicknessCm, side, face: picked } = selStoredWall
    const len = dist(a, b)
    const ux = len > 0 ? (b.x - a.x) / len : 0, uy = len > 0 ? (b.y - a.y) / len : 0
    // Left of a -> b is (-uy, ux): that is side L, the side the wall card calls side A.
    const off = thicknessCm / 2 + px(2)
    const face = (k: 1 | -1) => ({
      x1: a.x - uy * off * k, y1: a.y + ux * off * k, x2: b.x - uy * off * k, y2: b.y + ux * off * k,
    })
    // A selected face: both sides stay weak, and only the span of the face gets the strong line.
    const weight = (s: 'L' | 'R') => (!picked && (side === undefined || side === s) ? px(3) : px(1.5))
    const strongSide = (s: 'L' | 'R') => !picked && side === s
    const faceLine = picked && (() => {
      const k = picked.side === 'L' ? 1 : -1
      const x = (t: number) => a.x + ux * t - uy * off * k, y = (t: number) => a.y + uy * t + ux * off * k
      return { x1: x(picked.from), y1: y(picked.from), x2: x(picked.to), y2: y(picked.to) }
    })()
    const wall = (storedWalls ?? []).find((w) => w.id === selStoredWall.wallId)
    // "In line on": the dotted line of the side (A, centre or B) that lines up with the walls that
    // continue this one, so the choice of the wall card is visible on the plan.
    const alignOff = wallAlignOffsetCm(wall?.align, thicknessCm)
    const align = {
      x1: a.x - uy * alignOff, y1: a.y + ux * alignOff, x2: b.x - uy * alignOff, y2: b.y + ux * alignOff,
    }
    // A and B markers: the letters of the two sides of the wall card, outside the band and at the
    // same size at every zoom (px), so the user can match the card to the plan. They sit at 25 %
    // (A) and 75 % (B) of the wall, away from the thickness box at the middle of the band (r1fix
    // suggestion 5: the A badge touched that box).
    const markOff = thicknessCm / 2 + px(12)
    const marker = (k: 1 | -1, letter: 'A' | 'B') => {
      const onSide = letter === 'A' ? 'L' : 'R'
      const active = side === onSide
      const t = letter === 'A' ? 0.25 : 0.75
      const x = a.x + (b.x - a.x) * t - uy * markOff * k, y = a.y + (b.y - a.y) * t + ux * markOff * k
      return (
        <g key={letter} transform={`translate(${x} ${y})`} data-wall-side-marker={letter}
          data-wall-side-marker-active={active ? '' : undefined} aria-hidden="true" pointerEvents="none">
          <circle r={px(8)} strokeWidth={px(1)}
            className={active
              ? 'fill-orange-600 stroke-orange-700 dark:stroke-orange-300'
              : 'fill-white stroke-orange-500 dark:fill-slate-900'} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={px(10)} fontWeight={700}
            className={active ? 'fill-white' : 'fill-orange-700 dark:fill-orange-300'}>{letter}</text>
        </g>
      )
    }
    /**
     * Helper dimensions of the wall (docs/measurements-plan.md section 1): one dimension line per
     * face of each side, outside the band, with the length of that face, and the thickness of the
     * wall in a small box at the middle of the band. A measured face shows its measured value.
     */
    const helperDims = () => {
      if (!layers.dimensions) return null
      const helperOff = thicknessCm / 2 + px(22)
      const groups = (selWallView?.sides ?? []).map((s) => {
        const k = s.side === 'L' ? 1 : -1
        // Away from the band, on this side: (-uy, ux) is the left of a -> b, which is side L (A).
        const normal = { x: -uy * k, y: ux * k }
        const keys = sideFaceKeys(s)
        return s.faces.map((f, i) => {
          // A room face carries its own value ('EN-3'); an outside span has no value of its own,
          // except the facade value 'W12-E' of a side that is outside along its whole length. That
          // value then wins, green and bold, as in OutsideDimsLayer (round 2 finding 9).
          const faceCm = f.kind === 'room'
            ? f.measuredCm
            : s.outside && s.facadeLabel ? measurements[s.facadeLabel]?.actualCm : undefined
          const measuredFace = (faceCm ?? 0) > 0
          const faceState = f.kind === 'room'
            ? valueStates(f.label, f.measuredCm)
            : s.outside && s.facadeLabel ? valueStates(s.facadeLabel) : 'estimated'
          const solvedCm = shownLength(f.lengthCm, step)
          // A measured value that the plan does not fit: amber, "~412", and its breakdown on hover.
          const mismatch = measuredFace && !fitsPlan(faceCm as number, solvedCm, step)
          const text = measuredFace
            ? measuredTextIn(faceCm as number, solvedCm, step, units)
            : fmtLen(solvedCm, units)
          const line = dimLineOfSpan(a, b, normal, { from: f.from, to: f.to }, helperOff, zoom, text)
          if (!line) return null
          const dimKey = f.kind === 'room' && f.label ? f.label : keys[i] ?? s.side + i
          // A double-click types the value of the face; a click still selects or drags the room of a
          // room face (docs/measurements-plan.md section 4).
          const editLabel = canEditDims ? dimTextLabel('helper', dimKey, s.facadeLabel) : null
          // A room face of this wall is a wall of its room: Tab goes on to the next wall of the room.
          const room = f.kind === 'room' ? rooms.find((x) => x.id === f.roomId) : undefined
          if (editLabel && room) {
            dimPlaces.set(editLabel, {
              label: editLabel, at: line.text, plannedCm: f.lengthCm, roomCode: room.code, faces: roomWalls(room).length,
            })
          }
          const helperEditing = !!editLabel && editLabel === dimEditing
          // The breakdown of a value that does not fit: one small amber text, px(13) further away
          // from the wall than the value (perpendicular to the line of the dimension).
          const bx = line.text.x + normal.x * px(13), by = line.text.y + normal.y * px(13)
          return (
            <g key={s.side + dimKey} data-helper-dim={dimKey} data-helper-side={s.letter}>
              <DimLineView line={line} text={text} measured={measuredFace} state={faceState} kind="helper" dimKey={dimKey}
                mismatch={mismatch} hideText={helperEditing}
                onTextDoubleClick={editLabel ? () => openDim(editLabel, line.text, f.lengthCm, room) : undefined}
                onTextPointerDown={editLabel && f.kind === 'room'
                  ? (e) => onRoomDown(e, f.roomId, vp)
                  : undefined} />
              {mismatch && !helperEditing && (
                <text x={bx} y={by} textAnchor="middle" dominantBaseline="middle"
                  transform={`rotate(${line.angle} ${bx} ${by})`} fontSize={px(10)}
                  pointerEvents="none" paintOrder="stroke" strokeWidth={px(3)} strokeLinejoin="round"
                  data-dim-breakdown={editLabel ?? dimKey}
                  className={`stroke-[#f6f7f5] dark:stroke-[#12161b] ${MISMATCH_FILL}`}>
                  {measuredBreakdown(faceCm as number, solvedCm, units)}
                </text>
              )}
            </g>
          )
        })
      })
      // Thickness in a small box at the middle of the band, in the colours of a wall number badge.
      const n = fmtCm(thicknessCm)
      const h = px(13), bw = px(5) + px(5.6) * n.length
      return (
        <g pointerEvents="none" data-helper-dims={selStoredWall.wallId}>
          {groups}
          <g transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`} data-helper-thickness={n} aria-hidden="true">
            <rect x={-bw / 2} y={-h / 2} width={bw} height={h} rx={px(3)} strokeWidth={px(1)}
              className={badgeClass.none} />
            <text textAnchor="middle" dominantBaseline="middle" fontSize={px(9)} className={`font-mono ${badgeTextClass.none}`}>
              {n}
            </text>
          </g>
        </g>
      )
    }
    return (
      <g data-selected-wall-side={side ?? ''} data-wall-side-of={selStoredWall.wallId}>
        <g pointerEvents="none">
          <line {...face(1)} strokeLinecap="round" strokeWidth={weight('L')}
            className={strongSide('L') ? 'stroke-orange-600 dark:stroke-orange-300' : 'stroke-orange-500/70'} />
          <line {...face(-1)} strokeLinecap="round" strokeWidth={weight('R')}
            className={strongSide('R') ? 'stroke-orange-600 dark:stroke-orange-300' : 'stroke-orange-500/70'} />
          {faceLine && (
            <line {...faceLine} strokeLinecap="round" strokeWidth={px(3)} data-selected-wall-face={picked!.key}
              className="stroke-orange-600 dark:stroke-orange-300" />
          )}
        </g>
        <line {...align} pointerEvents="none" strokeWidth={px(2)} strokeLinecap="round"
          strokeDasharray={`${px(2)} ${px(4)}`} data-wall-align-line={selStoredWall.wallId}
          data-align={wall?.align ?? 'room'} className="stroke-sky-600 dark:stroke-sky-400" />
        {helperDims()}
        {marker(1, 'A')}
        {marker(-1, 'B')}
      </g>
    )
  })()

  /** Strong when the face is on the side the user clicked, weak when it is on the other side. */
  const wallNumberHighlight = (roomId: string, wallStart: string): 'strong' | 'weak' | null => {
    if (selection?.kind !== 'storedWall') return null
    const wall = (storedWalls ?? []).find((w) => w.id === selection.wallId)
    const face = wall?.faces.find((x) => x.roomId === roomId && x.wallStart === wallStart)
    if (!face) return null
    // A selected face: only that room face is strong, the other faces of the wall are weak.
    if (selection.face !== undefined) return selection.face === `room:${roomId}:${wallStart}` ? 'strong' : 'weak'
    return selection.side === undefined || selection.side === face.side ? 'strong' : 'weak'
  }

  /**
   * Text boxes of the outside dimension chains (round 2 finding R2-2: the badges of the outside
   * faces touched the texts '40' and '66' at 80 % and 64 %). The boxes come from the same pure
   * functions as the rows of outside/OutsideDimsLayer.tsx, and only when that layer draws. The
   * room wall dimension texts keep off them too (rule 2 of the declutter pass, visual review V-1).
   */
  const outsideTextBoxes = useMemo(() => {
    if (!isV2 || !layers.dimensions || !layers.outsideDims) return []
    if (mode === 'measure' && !isDesktop) return []
    // The same level-of-detail rule as the layer: only the rows it draws at this zoom.
    const runs = outsideDimsLod(outsideDims({ rooms, nodes: storedNodes, walls: storedWalls, measurements }), zoom)
    return outsideDimTextBoxes(runs, {
      zoom,
      // The same text rule as the rows of outside/OutsideDimsLayer.tsx: a measured face shows its
      // measured value, every other value its length in the units of the plan.
      segmentText: (seg) => {
        const measuredCm = seg.measuredCm ?? 0
        return measuredCm > 0
          ? measuredTextIn(measuredCm, seg.lengthCm, step, units)
          : fmtLen(seg.lengthCm, units)
      },
      overallText: (run) => fmtLen(run.overallCm, units),
    })
  }, [
    isV2, layers.dimensions, layers.outsideDims, mode, isDesktop,
    rooms, storedNodes, storedWalls, measurements, zoom, step, units,
  ])

  /**
   * The wall lengths of the plan: one entry per room wall that shows a value, with its dimension
   * line (in the "Lines" style) and its text. The boxes let the wall number badges stay off the
   * texts (r1fix R1-2), and one declutter pass (dims/declutter.ts) drops the texts that would
   * collide or cross a wall (visual review V-1, V-3, V-6, V-7).
   */
  type WallValue = {
    key: string
    dimKey: string
    /** Dimension line of the value; null in the "Text" style, or when the face is too short. */
    line: DimLine | null
    text: string
    measured: boolean
    /** Green measured, purple solved, grey estimated (docs/solver-plan.md). */
    state: ValueState
    /** Measured value that the plan does not fit: amber, and its text starts with "~". */
    mismatch: boolean
    /** Full value of a mismatch, shown on hover and on selection; null otherwise. */
    breakdown: string | null
    /** Place and angle of the text when it is drawn without a line. */
    p: Vec
    angle: number
    /** Unit normal of the face, into the room: the side the breakdown goes, past the value. */
    normal: Vec
    /** True when the wall face of this value is selected (the breakdown of a mismatch shows then). */
    faceSelected: boolean
    /** Box of the text, cm; null when the pass dropped it (the line and its ticks stay). */
    box: Box | null
    /** Corners of the turned text box, cm: the wall band test of the pass. */
    quad: Vec[] | null
    /** Room of the face: a press on its text selects or drags that room, as the plan does. */
    roomId: string
    /** Length of the face on the plan, cm: the placeholder of the typed length (section 4). */
    plannedCm: number
    /** Survey label of the face ('SE-2'); the value a typed length writes. */
    faceLabel: string | null
    /** A wall being dragged: always shown (7.2 #22). */
    forced: boolean
    /** Length of the wall, cm: a longer wall keeps its text first. */
    wallCm: number
    /** Inner ring of the room of the face, cm: the text must stay inside it. */
    ring: Vec[]
  }
  const wallValues: WallValue[] = []
  if (layers.dimensions) {
    for (const r of rooms) {
      const labels = new Map(surveyIds(r).filter((x) => x.kind === 'wall').map((x) => [x.wallStart, x.label]))
      // Lengths shown are inside faces, like the values measured on site.
      const inner = innerWallLengths(r)
      // Inside corners of the room: the face a wall length is measured on, corner to corner.
      const ring = roomInnerRing(r)
      // V-2: a room whose inside box is under px(60) in both directions shows no wall dimensions
      // at all: the tag keeps its code and its name, and the numbers leave the walls clean.
      if (smallRoomDims(ringBox(ring), zoom)) continue
      for (const w of roomWalls(r)) {
        // The selected wall shows its lengths as helper dimensions: no duplicate here (R1-4).
        if (hiddenDimFaces.has(r.id + ':' + w.start.id)) continue
        // A wall being dragged always shows its length (7.2 #22).
        const forced = forcedWalls.has(w.start.id)
        if (w.length * zoom < 55 && !forced) continue
        const m = measurements[labels.get(w.start.id) ?? '']
        const measured = !!m && m.actualCm > 0
        const props = wallProps(r, w.start.id)
        if (!wallAppearance(props.type, props.status, renovationView).visible) continue
        const off = props.thicknessCm / 2 + px(10)
        const mx = (w.start.x + w.end.x) / 2 + w.inward.x * off
        const my = (w.start.y + w.end.y) / 2 + w.inward.y * off
        let angle = (Math.atan2(w.dir.y, w.dir.x) * 180) / Math.PI
        if (angle > 90 || angle < -90) angle += 180
        const solvedCm = shownLength(inner[w.index], step)
        // A measured value the plan does not fit: one clean value on the plan ("~412"), amber, and
        // the breakdown (measured, plan, difference) only on hover and on selection.
        const mismatch = measured && !fitsPlan(m.actualCm, solvedCm, step)
        const text = measured ? measuredTextIn(m.actualCm, solvedCm, step, units) : fmtLen(solvedCm, units)
        const key = 'd' + r.id + w.start.id
        const dimKey = `${r.code}-${w.index + 1}`
        // "Wall lengths: Lines": a dimension line along the inside face of this wall (the span the
        // value measures), px(10) into the room, with a tick at each end and the value above the
        // line (docs/measurements-plan.md section 1). The line of a face that is too short for a
        // value (under px(24), or px(12) for a dragged wall) is not drawn at all (V-1).
        const faceStart = dimStyle === 'lines' ? ring[w.index] : undefined
        const faceEnd = dimStyle === 'lines' ? ring[(w.index + 1) % ring.length] : undefined
        const base = faceStart && faceEnd
          ? {
              start: faceStart, end: faceEnd, normal: w.inward, offsetCm: px(10), zoom,
              minLinePx: forced ? DIM_STYLE.minLine : DECLUTTER.minLinePx,
            }
          : null
        let line = base ? dimLine({ ...base, text }) : null
        // V-1, V-3, V-6: a value that does not fit between the ticks is not written past the end of
        // its line any more (that put numbers across walls and into other rooms): the line and the
        // ticks stay, the text goes. A dragged wall keeps the old rule (7.2 #22).
        let showText = true
        if (line && line.outside && !forced) {
          line = dimLine({ ...base!, text: '' })
          showText = false
        }
        const p = line ? line.text : { x: mx, y: my }
        const textAngle = line ? line.angle : angle
        wallValues.push({
          key, dimKey, line, text, measured, state: valueStates(labels.get(w.start.id), m?.actualCm), p, angle: textAngle,
          mismatch, breakdown: mismatch ? measuredBreakdown(m.actualCm, solvedCm, units) : null,
          normal: w.inward,
          // The face is selected: a selected stored wall face ('room:r1:cu-v1'), or a v1 wall.
          faceSelected: (selection?.kind === 'storedWall' && selection.face === `room:${r.id}:${w.start.id}`)
            || selWalls.has(`${r.id}:${w.start.id}`),
          box: showText ? textBox(p, textAngle, text, zoom) : null,
          quad: showText ? textQuad(p, textAngle, text, zoom) : null,
          roomId: r.id, plannedCm: shownLength(inner[w.index], step), faceLabel: dimTextLabel('wall', dimKey),
          forced, wallCm: w.length, ring,
        })
      }
    }
  }

  /**
   * The declutter pass of the wall dimension texts (dims/declutter.ts): measured values first, then
   * the longer walls; a text that hits a kept text, a room tag or an outside row text, or that
   * crosses the wall band of its room, is dropped, while its line and its ticks stay.
   */
  const keptTexts = keepDimTexts({
    candidates: wallValues.flatMap((d) => (d.box && d.quad
      ? [{ key: d.key, box: d.box, quad: d.quad, measured: d.measured, wallCm: d.wallCm, ring: d.ring, forced: d.forced }]
      : [])),
    blockers: [...tagBoxInRoom.values(), ...outsideTextBoxes],
    zoom,
  })
  for (const d of wallValues) {
    if (d.box && !keptTexts.kept.has(d.key)) {
      d.box = null
      d.quad = null
    }
  }

  // Tab / Shift+Tab of the field of a typed length: the next wall of the room whose text is drawn.
  if (canEditDims) {
    for (const d of wallValues) {
      if (!d.box || !d.faceLabel || !parseRoomWallLabel(d.faceLabel)) continue
      const room = rooms.find((r) => r.id === d.roomId)
      if (!room) continue
      dimPlaces.set(d.faceLabel, {
        label: d.faceLabel, at: d.p, plannedCm: d.plannedCm, roomCode: room.code, faces: roomWalls(room).length,
      })
    }
  }

  return (
    <g data-rooms-overlay="">
      {/* selection highlight of a room: drawn above the walls, so the dashes stay visible */}
      {rooms.filter((r) => selRoomIds.has(r.id)).map((r) => (
        <path key={'sel' + r.id} d={[r.vertices, ...r.holes].map((ring) => 'M' + ring.map((p) => `${p.x} ${p.y}`).join('L') + 'Z').join('')}
          fill="none" pointerEvents="none"
          data-selected-room={r.id}
          strokeWidth={px(2)} strokeDasharray={`${px(6)} ${px(4)}`} className="stroke-orange-500" />
      ))}

      {selectedWallSide}

      {/* Solver On: the BASE position of the hovered (or selected) wall that the solver moved, as a
          thin dashed purple line (docs/solver-plan.md, "Purple everywhere"). Nothing when Off. */}
      <SolverGhostLayer />

      {/* hover highlight: the element of the survey label under the pointer in the Solve tab list
          (and in Measuring Mode). It takes no pointer event. */}
      {hoverWall && (
        <line x1={hoverWall.w.start.x} y1={hoverWall.w.start.y} x2={hoverWall.w.end.x} y2={hoverWall.w.end.y}
          pointerEvents="none" strokeLinecap="round" data-hover-highlight="wall" data-hover-label={hoverLabel ?? ''}
          strokeWidth={Math.max(hoverWall.thicknessCm, px(10)) + px(4)}
          className="stroke-orange-500/40 dark:stroke-orange-400/45" />
      )}
      {hover?.kind === 'storedWall' && (
        <g pointerEvents="none" data-hover-highlight="stored-wall" data-hover-label={hover.label}>
          {/* Centre line of the stored wall: the line the two values of the wall are measured on. */}
          <line x1={hover.a.x} y1={hover.a.y} x2={hover.b.x} y2={hover.b.y}
            strokeWidth={px(12)} strokeLinecap="round"
            className="stroke-orange-500/35 dark:stroke-orange-400/40" />
          <line x1={hover.a.x} y1={hover.a.y} x2={hover.b.x} y2={hover.b.y}
            strokeWidth={px(2)} strokeLinecap="round" strokeDasharray={hover.outside ? `${px(9)} ${px(5)}` : undefined}
            className="stroke-orange-500/90 dark:stroke-orange-400/90" />
          <text x={(hover.a.x + hover.b.x) / 2} y={(hover.a.y + hover.b.y) / 2}
            textAnchor="middle" dominantBaseline="middle" fontSize={px(12)} fontWeight={600}
            strokeWidth={px(3)} paintOrder="stroke" strokeLinejoin="round" data-hover-length={hover.label}
            className="fill-orange-700 stroke-white dark:fill-orange-200 dark:stroke-slate-900">
            {hover.outside ? 'outside ' : ''}{fmtLen(dist(hover.a, hover.b), units)} {unitSuffix(units)}
          </text>
        </g>
      )}
      {hover?.kind === 'diagonal' && (
        <g pointerEvents="none" data-hover-highlight="diagonal" data-hover-label={hover.label}>
          <line x1={hover.a.x} y1={hover.a.y} x2={hover.b.x} y2={hover.b.y}
            strokeWidth={px(3)} strokeLinecap="round" strokeDasharray={`${px(8)} ${px(5)}`}
            className="stroke-orange-500/90 dark:stroke-orange-400/90" />
          {/* Planned length of the diagonal: what the tape should read on site. */}
          <text x={(hover.a.x + hover.b.x) / 2} y={(hover.a.y + hover.b.y) / 2}
            textAnchor="middle" dominantBaseline="middle" fontSize={px(12)} fontWeight={600}
            strokeWidth={px(3)} paintOrder="stroke" strokeLinejoin="round" data-hover-length={hover.label}
            className="fill-orange-700 stroke-white dark:fill-orange-200 dark:stroke-slate-900">
            {fmtLen(dist(hover.a, hover.b), units)} {unitSuffix(units)}
          </text>
        </g>
      )}

      {/* "In line on" of the walls of a v1 document: the line of each selected wall that lines up
          with the walls that continue it */}
      {selWalls.size > 0 && rooms.map((r) => roomWalls(r).filter((w) => selWalls.has(r.id + ':' + w.start.id)).map((w) => {
        const p = wallProps(r, w.start.id)
        const k = (p.align ?? 'room') === 'room' ? 1 : p.align === 'other' ? -1 : 0
        const o = (k * p.thicknessCm) / 2
        const x1 = w.start.x + w.inward.x * o, y1 = w.start.y + w.inward.y * o
        const x2 = w.end.x + w.inward.x * o, y2 = w.end.y + w.inward.y * o
        return (
          <line key={'align' + r.id + w.start.id} x1={x1} y1={y1} x2={x2} y2={y2} pointerEvents="none"
            data-wall-align-line={r.id + ':' + w.start.id} data-align={p.align ?? 'room'}
            strokeWidth={px(2)} strokeLinecap="round" strokeDasharray={`${px(2)} ${px(4)}`}
            className="stroke-sky-600 dark:stroke-sky-400" />
        )
      }))}

      {/* labels + dimensions */}
      {display.map(label)}
      {wallValues.map((d) => {
        // A double-click on the text types the measured value of the face; a click still selects or
        // drags the room under it (docs/measurements-plan.md section 4).
        const editLabel = canEditDims && d.box ? d.faceLabel : null
        // The field of this text is open: it replaces the text (it is drawn above this layer).
        const editing = !!editLabel && editLabel === dimEditing
        const onTextDoubleClick = editLabel ? () => openDim(editLabel, d.p, d.plannedCm, rooms.find((r) => r.id === d.roomId)) : undefined
        const onTextPointerDown = editLabel ? (e: ReactPointerEvent) => onRoomDown(e, d.roomId, vp) : undefined
        // The pointer on the text names its face ('A-1') in the plan: the breakdown of a value that
        // does not fit shows while it is there, and goes when it leaves (`hoverLabel`, as the
        // survey cards of the panel do).
        const hovered = interactive ? d.faceLabel : null
        const onTextPointerEnter = hovered ? () => useUi.getState().set({ hoverLabel: hovered }) : undefined
        const onTextPointerLeave = hovered
          ? () => { if (useUi.getState().hoverLabel === hovered) useUi.getState().set({ hoverLabel: null }) }
          : undefined
        // The declutter pass dropped this text (V-1, V-3, V-6, V-7): the line and its ticks stay,
        // and a value written without a line ("Text" style) draws nothing at all.
        if (!d.box) {
          return d.line
            ? <DimLineView key={d.key} line={d.line} text={d.text} measured={d.measured} state={d.state} kind="wall" dimKey={d.dimKey}
                mismatch={d.mismatch} hideText />
            : null
        }
        if (editing && !d.line) return null
        // The full breakdown of a value the plan does not fit: on hover, and on the selected face
        // (r1fix: the plan shows ONE value, the rest goes on demand).
        const breakdown = d.breakdown && !editing && (hoverLabel === d.faceLabel || d.faceSelected)
          ? (
            <text key={d.key + '-bd'} x={d.p.x + d.normal.x * px(13)} y={d.p.y + d.normal.y * px(13)}
              textAnchor="middle" dominantBaseline="middle"
              transform={`rotate(${d.angle} ${d.p.x + d.normal.x * px(13)} ${d.p.y + d.normal.y * px(13)})`}
              fontSize={px(10)} pointerEvents="none" paintOrder="stroke" strokeWidth={px(3)}
              strokeLinejoin="round" data-dim-breakdown={d.faceLabel}
              className={`stroke-[#f6f7f5] dark:stroke-[#12161b] ${MISMATCH_FILL}`}>
              {d.breakdown}
            </text>
          )
          : null
        const value = d.line
          ? <DimLineView key={d.key} line={d.line} text={d.text} measured={d.measured} state={d.state} kind="wall" dimKey={d.dimKey}
              mismatch={d.mismatch} hideText={editing} onTextDoubleClick={onTextDoubleClick} onTextPointerDown={onTextPointerDown}
              onTextPointerEnter={onTextPointerEnter} onTextPointerLeave={onTextPointerLeave} />
          : (
            // The dimensions layer set to "Text", or a wall shorter than px(12) on screen: the text
            // alone, as before (the lengths of the walls of a dragged vertex stay readable, 7.2 #22).
            <text key={d.key} x={d.p.x} y={d.p.y} textAnchor="middle" dominantBaseline="middle"
              transform={`rotate(${d.angle} ${d.p.x} ${d.p.y})`} fontSize={px(11)}
              pointerEvents={editLabel || onTextPointerEnter ? 'auto' : 'none'}
              style={editLabel ? { cursor: 'text' } : undefined}
              onDoubleClick={onTextDoubleClick && ((e) => { e.stopPropagation(); onTextDoubleClick() })}
              onPointerDown={onTextPointerDown}
              onPointerEnter={onTextPointerEnter} onPointerLeave={onTextPointerLeave}
              data-dim-text={editLabel ?? undefined} data-dim-state={d.state}
              data-dim-mismatch={d.mismatch ? '' : undefined}
              paintOrder="stroke"
              strokeWidth={px(3)} strokeLinejoin="round" fontWeight={d.measured ? 600 : undefined}
              className={`stroke-[#f6f7f5] dark:stroke-[#12161b] ${valueFill(d.state, d.mismatch)}`}>
              {d.text}
            </text>
          )
        return breakdown ? [value, breakdown] : value
      })}

      {/* wall numbers: a small badge with the number of the wall ("6" = wall CU-6 of room CU),
          near the START end of the wall and in the band of the dimension text, so it never sits on
          that text (r1fix R1-2: the badge used to sit on the middle of the wall, one pixel from
          the middle of the text). When the start end is taken by a value, the badge takes the END
          of the line; a badge with no free place on a text of the plan (wall values AND outside
          chains, round 2 finding R2-2) is not drawn at all. The badge of a selected stored wall is
          orange on the side the user clicked, light orange on the other side, and a wall too short
          on screen shows no badge (it would touch its neighbours). */}
      {showWallNumbers && rooms.map((r) => {
        const ring = roomInnerRing(r)
        return roomWalls(r).map((w) => {
          if (w.length * zoom < 32) return null
          const props = wallProps(r, w.start.id)
          if (!wallAppearance(props.type, props.status, renovationView).visible) return null
          // The face the wall length is written on: the badge keeps out of its text band.
          const faceStart = ring[w.index], faceEnd = ring[(w.index + 1) % ring.length]
          const dimShown = layers.dimensions && (w.length * zoom >= 55 || forcedWalls.has(w.start.id))
            && !hiddenDimFaces.has(r.id + ':' + w.start.id)
          const n = String(w.index + 1)
          // The line of the value: the dimension line when it is drawn, else the face itself (the
          // text-only style writes the value px(10) into the room from the face).
          const valueLine = dimShown && dimStyle === 'lines'
            ? dimLine({ start: faceStart, end: faceEnd, normal: w.inward, offsetCm: px(10), zoom, text: '' })
            : null
          // Distance from that line to the middle of the dimension text, px; null when no text.
          const textOffPx = dimShown ? (valueLine ? DIM_STYLE.textGap : 10) : null
          // Near the start end of the line, or near its end when the start one is taken: never on a
          // dimension text of the plan, with a small margin for the real text box of the browser
          // (r1fix R1-2 and round 2 finding R2-2: 2 badges on the '86' of WC-2 / WC-4 at 100 %, and
          // badges on the outside texts '40' and '66' at 80 % and 64 %). The number is a helper, the
          // value is the point, so a badge with no free place is not drawn at all.
          const picked = pickWallBadge(
            wallBadgePlaces({
              lineA: valueLine ? { x: valueLine.x1, y: valueLine.y1 } : faceStart,
              lineB: valueLine ? { x: valueLine.x2, y: valueLine.y2 } : faceEnd,
              normal: w.inward, badge: n, textOffPx, zoom,
            }),
            // The FINAL texts of the plan: the values the declutter pass kept (V-1) and the texts of
            // the outside rows. A badge never sits on one of them.
            [...keptTexts.boxes, ...outsideTextBoxes],
            worldPx(DIM_STYLE.badgeGap, zoom),
          )
          if (!picked) return null
          const { x: mx, y: my } = picked.centre
          const kind = wallNumberHighlight(r.id, w.start.id) ?? (selWalls.has(r.id + ':' + w.start.id) ? 'strong' : 'none')
          const h = px(13), bw = px(5) + px(5.6) * n.length
          return (
            <g key={'wn' + r.id + w.start.id} transform={`translate(${mx} ${my})`} pointerEvents="none"
              data-wall-number={n} data-wall-label={`${r.code}-${n}`} data-wall-number-state={kind} aria-hidden="true">
              <rect x={-bw / 2} y={-h / 2} width={bw} height={h} rx={px(3)} strokeWidth={px(1)}
                className={badgeClass[kind]} />
              <text textAnchor="middle" dominantBaseline="middle" fontSize={px(9)}
                className={`font-mono ${badgeTextClass[kind]}`}>
                {n}
              </text>
            </g>
          )
        })
      })}

      {/* inline room rename editor: topmost, so no hit area can steal its clicks */}
      {rooms.filter((r) => r.id === editing).map((r) => (
        <RoomNameEditor key={'edit' + r.id} room={r} vp={vp} onClose={closeEditor} />
      ))}

      {/* the field that types the length of a dimension text (docs/measurements-plan.md section 4):
          topmost too, so a hit area of the plan never takes its clicks or its focus */}
      <DimEditor onStep={stepDim} />
    </g>
  )
}
