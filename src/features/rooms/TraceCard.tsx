// Inspect card of one traced wall (docs/walls-plan.md phase 6): length, thickness, type, delete.
// A trace is a drawing aid: the Make room tool gives its thickness and type to the new room walls.
import { Trash2 } from 'lucide-react'
import { fmtCm } from '../../model/geometry'
import type { TraceWall } from '../../model/types'
import { FieldRow, IconButton, NumberField, PanelSection, Segmented } from '../../shell/panel'
import { WALL_TYPES } from './cards'
import { patchTrace, removeTrace } from './traceActions'
import { safeType } from './wallToolLogic'

export function TraceCard({ trace, onPatch, onDelete }: {
  trace: TraceWall
  onPatch: (patch: Partial<TraceWall>) => void
  onDelete: () => void
}) {
  const length = Math.hypot(trace.b.x - trace.a.x, trace.b.y - trace.a.y)
  return (
    <PanelSection
      title="Traced wall"
      description="A drawn wall centre line. The Make room tool turns it into a room wall."
      actions={<IconButton label="Delete traced wall" variant="danger" icon={<Trash2 size={16} />} onClick={onDelete} />}
    >
      <FieldRow label="Length">
        <span className="text-sm tabular-nums text-slate-900 dark:text-slate-100">{fmtCm(length)} cm</span>
      </FieldRow>
      <FieldRow label="Type" stacked>
        <Segmented ariaLabel="Traced wall type" options={WALL_TYPES} value={trace.type} onChange={(t) => onPatch({ type: safeType(t) })} />
      </FieldRow>
      <FieldRow label="Thickness" htmlFor="trace-thickness">
        <NumberField
          id="trace-thickness"
          name="traceThickness"
          ariaLabel="Thickness of the traced wall"
          value={trace.thicknessCm}
          unit="cm"
          min={1}
          max={100}
          onCommit={(v) => {
            if (v === null || !(v > 0)) return false
            onPatch({ thicknessCm: v })
            return true
          }}
        />
      </FieldRow>
    </PanelSection>
  )
}

/** Same card, connected to the stores. */
export function TraceCardConnected({ trace }: { trace: TraceWall }) {
  return (
    <TraceCard
      trace={trace}
      onPatch={(patch) => patchTrace(trace.id, patch)}
      onDelete={() => removeTrace(trace.id)}
    />
  )
}
