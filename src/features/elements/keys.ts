// Keys of the place-element tool (docs/measurements-plan.md section 7). Pure: the tool maps the
// answer of placeKeyAction to a store write and applies the handler rules tested here.

export type PlaceKeyAction =
  /** F: the door hinge goes to its other end (start <-> end). */
  | 'flip'
  /** L: repeat (the tool stays after a placement) versus once (back to Select). */
  | 'repeat'
  /** Any other key: the tool does nothing, the shell shortcuts keep it. */
  | null

/**
 * Decision for one keydown of the place-element tool.
 * `typing` = the focus is in a text control (input, textarea, select, contenteditable): the keys of
 * the tool are ignored there, so typing "f" in a field never flips a hinge.
 * A modifier key (Cmd, Ctrl, Alt) or an auto-repeat also gives null, so browser shortcuts and
 * held keys keep their meaning.
 */
export function placeKeyAction(
  key: string,
  opts: { typing?: boolean; mod?: boolean; repeat?: boolean } = {},
): PlaceKeyAction {
  if (opts.typing || opts.mod || opts.repeat) return null
  const k = key.toLowerCase()
  if (k === 'f') return 'flip'
  if (k === 'l') return 'repeat'
  return null
}
