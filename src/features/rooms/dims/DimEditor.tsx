// The small field that types the length of ONE dimension text on the plan (docs/measurements-plan.md
// section 4). It opens on a double-click on a dimension text, in Edit mode with the Select tool:
// an HTML <input> over the SVG, placed where the text is, like RoomNameEditor.tsx does it.
//
// Enter (or leaving the field) writes the MEASURED value of the face, with the same write as
// Measuring Mode: `setMeasurement(label, cm, measureSource, targetOfLabel(doc, label))`. Empty text
// removes the value. Esc cancels, in the CAPTURE phase, so App.tsx does not change the selection.
// Tab / Shift+Tab save and open the next / previous wall of the same room. A number that does not
// read is an error: red border, a message, and the field stays open.
import { useEffect, useRef, useState } from 'react'
import { useViewport } from '../../../canvas/Viewport'
import { fmtCm } from '../../../model/geometry'
import { useDoc, useUi } from '../../../model/store'
import { targetOfLabel } from '../../../model/v2/targets'
import { formatCmInput } from '../../../shell/panel/number'
import { setMeasurement } from '../../measure/actions'
import { parseDimValue, useDimEdit, type DimEditOpen, type DimEditorStep } from './dimEdit'

/** The field is about 90 px wide with its unit suffix (screen px). */
const FIELD_PX = 64
const BOX_W_PX = 92
const BOX_H_PX = 22

/**
 * The field of the open dimension text (nothing when no text is open). `onStep` says where Tab goes
 * next; without it, Tab keeps the field open.
 */
export function DimEditor({ onStep }: { onStep?: DimEditorStep }) {
  const edit = useDimEdit((s) => s.edit)
  if (!edit) return null
  // A new label is a new field: fresh text, fresh error, fresh focus.
  return <DimField key={edit.label} edit={edit} onStep={onStep} />
}

function DimField({ edit, onStep }: { edit: DimEditOpen; onStep?: DimEditorStep }) {
  const { px } = useViewport()
  const current = useDoc((s) => s.doc.measurements[edit.label]?.actualCm)
  const [value, setValue] = useState(() => formatCmInput(current))
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  /** Set as soon as the field commits or goes away, so the blur that follows does not write twice. */
  const closed = useRef(false)
  const cancel = useRef<() => void>(() => {})

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  /** Write the value of the field: the measured value of that face, or no value at all. */
  const write = (cm: number | null) => {
    // Typing the value that is already stored must not touch the document (no sync noise).
    if ((current ?? null) === cm) return
    // Empty text removes the value, exactly as Measuring Mode does it.
    if (cm === null) {
      setMeasurement(edit.label, null, undefined, undefined, { undo: true })
      return
    }
    const doc = useDoc.getState().doc
    setMeasurement(edit.label, cm, useUi.getState().measureSource, targetOfLabel(doc, edit.label), { undo: true })
  }

  /** Save the text. False when it does not read: the field stays open on its message. */
  const save = (): boolean => {
    const read = parseDimValue(value)
    if (read.kind === 'invalid') {
      setError(read.message)
      return false
    }
    setError(null)
    write(read.kind === 'empty' ? null : read.cm)
    return true
  }

  const finish = () => {
    if (closed.current) return
    if (!save()) {
      // The text does not read: the field stays open on its message and takes the focus back.
      input.current?.focus()
      return
    }
    closed.current = true
    useDimEdit.getState().close()
  }

  const stop = () => {
    if (closed.current) return
    closed.current = true
    useDimEdit.getState().close()
  }
  cancel.current = stop

  /** Tab / Shift+Tab: save, then open the next / previous wall of the same room. */
  const step = (delta: number) => {
    const next = onStep?.(edit, delta)
    if (!next) return
    if (!save()) return
    closed.current = true
    useDimEdit.getState().open(next)
  }

  // Esc in the CAPTURE phase: App.tsx listens on the window in the bubble phase and would change the
  // selection, and the viewport would pan. The field only cancels its own edit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancel.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const w = px(BOX_W_PX), h = px(BOX_H_PX)
  const placeholder = edit.plannedCm > 0 ? fmtCm(edit.plannedCm) : ''
  return (
    <foreignObject
      x={edit.at.x - w / 2}
      y={edit.at.y - h / 2}
      width={w}
      height={h}
      className="overflow-visible"
      data-dim-editor-box={edit.label}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col" style={{ width: px(BOX_W_PX) }}>
        <div className="flex items-center" style={{ gap: px(3) }}>
          <input
            ref={input}
            name="dimValue"
            type="text"
            inputMode="decimal"
            value={value}
            placeholder={placeholder}
            aria-label={`Measured ${edit.label}`}
            aria-invalid={error ? true : undefined}
            data-dim-editor={edit.label}
            onChange={(e) => setValue(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={finish}
            onKeyDown={(e) => {
              // Tool shortcuts and the viewport listeners must stay out of the way.
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); finish() }
              else if (e.key === 'Tab') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
              else if (e.key === 'Escape') { e.preventDefault(); stop() }
            }}
            className={`box-border rounded-sm border bg-white font-semibold text-slate-800 shadow-sm outline-none dark:bg-slate-900 dark:text-slate-100 ${
              error ? 'border-red-500 dark:border-red-400' : 'border-emerald-600 dark:border-emerald-400'
            }`}
            style={{
              width: px(FIELD_PX),
              height: px(BOX_H_PX),
              fontSize: px(12),
              lineHeight: 1.1,
              paddingInline: px(3),
              paddingBlock: 0,
              borderWidth: px(error ? 2 : 1),
            }}
          />
          <span className="text-slate-600 dark:text-slate-300" style={{ fontSize: px(11) }}>
            cm
          </span>
        </div>
        {error && (
          <p
            role="alert"
            data-dim-editor-error=""
            className="rounded-sm bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
            style={{ fontSize: px(10), marginTop: px(2), padding: px(2) }}
          >
            {error}
          </p>
        )}
      </div>
    </foreignObject>
  )
}
