// Inspect card for one point of a room: outline vertex or hole vertex, plus the hole note
// when a cutout is selected (docs/sidebar-plan-3.md step 4).
import { FieldRow, MUTED, NumberField, PanelSection } from '../../shell/panel'
import type { Room } from '../../model/types'
import type { ActiveHole } from './cards'
import { setVertexPos } from './cards'
import { vertexLocked } from './ops'

/** Hole note: shown under the vertex card and under the room card. */
export function HoleCard() {
  return (
    <PanelSection title="Hole">
      <p className={MUTED}>Hole selected. Drag its handles to reshape it. Press Delete to remove the whole hole.</p>
    </PanelSection>
  )
}

export function VertexCard({ room, vertexId, activeHole }: { room: Room; vertexId: string; activeHole: ActiveHole }) {
  const outlineVertex = room.vertices.find((v) => v.id === vertexId)
  const holeVertex = outlineVertex ? undefined : room.holes.flat().find((v) => v.id === vertexId)
  const vertex = outlineVertex ?? holeVertex
  if (!vertex) return activeHole ? <HoleCard /> : null
  const holeRing = holeVertex ? room.holes.find((h) => h.some((v) => v.id === holeVertex.id)) : undefined

  return (
    <>
      <PanelSection title={holeVertex ? 'Hole vertex' : 'Vertex'}>
        {(['x', 'y'] as const).map((axis) => (
          <FieldRow key={axis} label={axis.toUpperCase()} htmlFor={`vertex-${axis}`}>
            <NumberField
              id={`vertex-${axis}`}
              name={`vertex-${axis}`}
              unit="cm"
              value={Math.round(vertex[axis] * 10) / 10}
              disabled={!holeVertex && vertexLocked(room, vertex.id)}
              onCommit={(v) => {
                if (v === null || !Number.isFinite(v)) return false
                setVertexPos(room.id, vertex.id, !!holeVertex, { x: vertex.x, y: vertex.y, [axis]: v })
              }}
            />
          </FieldRow>
        ))}
        <p className={MUTED}>
          Corners of other rooms at the same place move too{!holeVertex && vertexLocked(room, vertex.id) ? ' (locked: a wall at this corner is locked)' : ''}. Press Delete to remove it
          {holeVertex ? ((holeRing?.length ?? 0) <= 3 ? ' (a hole needs 3 vertices)' : '') : (room.vertices.length <= 3 ? ' (a room needs 3 vertices)' : '')}.
        </p>
      </PanelSection>
      {activeHole && <HoleCard />}
    </>
  )
}
