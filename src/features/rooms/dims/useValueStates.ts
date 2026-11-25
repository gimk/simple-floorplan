// The value-state lookup of the document in the store (dims/valueStates.ts), built once per
// document: the plan layers ask it for the colour of every length text, green measured, purple
// solved, grey estimated (docs/solver-plan.md).
import { useMemo } from 'react'
import { useDoc } from '../../../model/store'
import { makeValueStates, type ValueStates } from './valueStates'

export function useValueStates(): ValueStates {
  const doc = useDoc((s) => s.doc)
  return useMemo(() => makeValueStates(doc), [doc])
}
