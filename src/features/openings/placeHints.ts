// Hint shown under the object picker while the place-opening tool is armed, per kind.
// Kept out of ObjectsPanel.tsx so that file only exports components (fast refresh).
import type { OpeningKind } from '../../model/types'

export const PLACE_HINTS: Record<OpeningKind, string> = {
  door: 'Click a wall to lock the door, move the cursor to choose hinge and swing, then click again to place. Esc cancels.',
  window: 'Click a wall to place the window. Esc cancels.',
  opening: 'Click a wall to place the opening. Esc cancels.',
}
