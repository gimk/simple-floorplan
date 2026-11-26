// Inspect card for the selected reference image.
import { Trash2 } from 'lucide-react'
import { useDoc } from '../../model/store'
import { useUi } from '../../shell/uiStore'
import { BTN, CheckboxRow, FieldRow, IconButton, NumberField, PanelSection, TextField } from '../../shell/panel'
import { normalizeDeg, rotateBy } from './rotate'

/** cmPerPx is shown as cm per 100 px: the field rounds to 0.1, so raw cmPerPx would lose digits. */
const PER = 100

export function RefImageInspect({ imageId }: { imageId: string }) {
  const img = useDoc((s) => s.doc.refImages.find((r) => r.id === imageId))
  if (!img) return null
  const patch = (p: Parameters<ReturnType<typeof useDoc.getState>['updateRefImage']>[1]) => useDoc.getState().updateRefImage(img.id, p)

  const remove = () => {
    useDoc.getState().deleteRefImage(img.id)
    useUi.getState().set({ selection: { kind: 'none' }, tool: 'select', calibratingImageId: null })
  }

  return (
    <PanelSection title="Reference image" actions={<IconButton label="Delete reference image" variant="danger" icon={<Trash2 size={16} />} onClick={remove} />}>
      <FieldRow label="Name">
        <TextField ariaLabel="Name" value={img.name} onCommit={(v) => patch({ name: v })} />
      </FieldRow>
      <FieldRow label="Opacity">
        <div className="flex items-center gap-2">
          <input
            type="range" min={0} max={100} step={1}
            aria-label="Opacity slider"
            value={Math.round(img.opacity * 100)}
            onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
            className="min-w-0 flex-1 accent-orange-700"
          />
          <NumberField ariaLabel="Opacity" unit="%" min={0} max={100} className="w-20" value={Math.round(img.opacity * 100)} onCommit={(v) => { if (v !== null) patch({ opacity: v / 100 }) }} />
        </div>
      </FieldRow>
      <FieldRow label="Scale" hint="cm per 100 px">
        <NumberField ariaLabel="Scale (cm per 100 px)" unit="cm" min={0.1} value={Math.round(img.cmPerPx * PER * 100) / 100} onCommit={(v) => { if (v === null || v <= 0) return false; patch({ cmPerPx: v / PER }) }} />
      </FieldRow>
      <button type="button" className={BTN} onClick={() => useUi.getState().set({ tool: 'calibrate-image', calibratingImageId: img.id })}>
        Calibrate (2-point)
      </button>
      <FieldRow label="Rotation">
        <div className="flex items-center gap-1">
          <NumberField ariaLabel="Rotation" unit="°" className="min-w-0 flex-1" value={Math.round(img.rotationDeg * 10) / 10} onCommit={(v) => { if (v !== null) patch({ rotationDeg: normalizeDeg(v) }) }} />
          <button type="button" className={BTN} aria-label="Rotate -90 degrees" onClick={() => patch({ rotationDeg: rotateBy(img.rotationDeg, -90) })}>-90°</button>
          <button type="button" className={BTN} aria-label="Rotate +90 degrees" onClick={() => patch({ rotationDeg: rotateBy(img.rotationDeg, 90) })}>+90°</button>
        </div>
      </FieldRow>
      <CheckboxRow label="Visible" checked={img.visible} onChange={(v) => patch({ visible: v })} />
      <CheckboxRow label="Locked" checked={img.locked} onChange={(v) => patch({ locked: v })} />
      <button type="button" className={`${BTN} text-red-600 dark:text-red-400`} onClick={remove}>Delete</button>
    </PanelSection>
  )
}
