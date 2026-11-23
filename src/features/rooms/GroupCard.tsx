// Inspect card for a Shift + click group of rooms or points: a summary only, the controls
// of the primary item stay hidden so the panel shows one context at a time
// (docs/sidebar-plan-3.md step 4). A group of walls uses WallCard instead.
import { EmptyHint, PanelSection } from '../../shell/panel'

export function GroupCard({ kind, count }: { kind: 'room' | 'vertex'; count: number }) {
  return (
    <PanelSection title={`${count} ${kind === 'room' ? 'rooms' : 'points'} selected`}>
      <EmptyHint>Drag one of them to move all. Delete removes all. Shift + click adds or removes one.</EmptyHint>
    </PanelSection>
  )
}
