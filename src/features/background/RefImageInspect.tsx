// Inspect card for the selected reference image: back link, Calibrate first, readable scale,
// name, opacity, position, rotation, header eye / lock toggles and one Delete at the bottom.
import { Eye, EyeOff, Lock, LockOpen, Ruler } from 'lucide-react'
import { useDoc } from '../../model/store'
import { useUi } from '../../shell/uiStore'
import {
  BTN,
  BTN_PRIMARY,
  BackLink,
  DangerButton,
  EmptyHint,
  FieldRow,
  IconButton,
  NumberField,
  PanelSection,
  TextField,
  formatDecimal,
} from '../../shell/panel'
import { selectArtboard } from '../artboards/selection'
import { toast } from '../toast'
import { normalizeDeg, rotateBy } from './rotate'

/** cmPerPx is shown as cm per 100 px: the field rounds to 0.1, so raw cmPerPx would lose digits. */
const PER = 100

export function RefImageInspect({ imageId }: { imageId: string }) {
  const img = useDoc((s) => s.doc.refImages.find((r) => r.id === imageId))
  const artboards = useDoc((s) => s.doc.artboards)
  const activeArtboardId = useUi((s) => s.activeArtboardId)
  if (!img) return null
  const patch = (p: Parameters<ReturnType<typeof useDoc.getState>['updateRefImage']>[1]) => useDoc.getState().updateRefImage(img.id, p)

  const artboard = artboards.find((a) => a.id === activeArtboardId) ?? artboards[0]
  const imageName = img.name.trim() === '' ? 'image' : img.name

  const remove = () => {
    useDoc.getState().deleteRefImage(img.id)
    useUi.getState().set({ selection: { kind: 'none' }, tool: 'select', calibratingImageId: null })
    toast(`Deleted ${imageName}`, { kind: 'info', actionLabel: 'Undo', onAction: () => useDoc.getState().undo() })
  }

  const widthM = (img.naturalWidth * img.cmPerPx) / 100
  const heightM = (img.naturalHeight * img.cmPerPx) / 100

  return (
    <PanelSection
      title="Reference image"
      actions={
        <>
          <IconButton
            label={img.visible ? 'Hide image' : 'Show image'}
            pressed={!img.visible}
            icon={img.visible ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
            onClick={() => patch({ visible: !img.visible })}
          />
          <IconButton
            label={img.locked ? 'Unlock image' : 'Lock image'}
            pressed={img.locked}
            icon={img.locked ? <Lock size={16} aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />}
            onClick={() => patch({ locked: !img.locked })}
          />
        </>
      }
    >
      {artboard ? (
        <BackLink name={artboard.name.trim() === '' ? 'Untitled artboard' : artboard.name} onClick={() => selectArtboard(artboard.id)} />
      ) : (
        <BackLink label="Close" onClick={() => useUi.getState().set({ selection: { kind: 'none' } })} />
      )}

      <button
        type="button"
        className={BTN_PRIMARY}
        title="Click two points of the image and type the real distance between them"
        onClick={() => useUi.getState().set({ tool: 'calibrate-image', calibratingImageId: img.id })}
      >
        <Ruler size={14} aria-hidden="true" />
        Set scale from 2 points
      </button>
      <EmptyHint>
        {`1 px = ${formatDecimal(img.cmPerPx, 2)} cm · image is ${formatDecimal(widthM, 2)} × ${formatDecimal(heightM, 2)} m`}
      </EmptyHint>

      <FieldRow label="Name">
        <TextField
          ariaLabel="Name"
          value={img.name}
          onCommit={(v) => {
            const name = v.trim()
            if (name === '') return false
            if (name === img.name) return
            patch({ name })
          }}
          invalidMessage="Type a name for the image."
        />
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

      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="X" labelWidth="w-4" hint="">
          <NumberField ariaLabel="Image X position" unit="cm" value={Math.round(img.xCm * 10) / 10} onCommit={(v) => { if (v === null) return false; patch({ xCm: v }) }} />
        </FieldRow>
        <FieldRow label="Y" labelWidth="w-4" hint="">
          <NumberField ariaLabel="Image Y position" unit="cm" value={Math.round(img.yCm * 10) / 10} onCommit={(v) => { if (v === null) return false; patch({ yCm: v }) }} />
        </FieldRow>
      </div>

      <FieldRow label="Rotation">
        <div className="flex items-center gap-1">
          <NumberField ariaLabel="Rotation" unit="°" className="min-w-0 flex-1" value={Math.round(img.rotationDeg * 10) / 10} onCommit={(v) => { if (v !== null) patch({ rotationDeg: normalizeDeg(v) }) }} />
          <button type="button" className={BTN} aria-label="Rotate -90 degrees" onClick={() => patch({ rotationDeg: rotateBy(img.rotationDeg, -90) })}>-90°</button>
          <button type="button" className={BTN} aria-label="Rotate +90 degrees" onClick={() => patch({ rotationDeg: rotateBy(img.rotationDeg, 90) })}>+90°</button>
        </div>
      </FieldRow>

      <DangerButton onClick={remove} shortcut="Del">
        Delete image
      </DangerButton>
    </PanelSection>
  )
}
