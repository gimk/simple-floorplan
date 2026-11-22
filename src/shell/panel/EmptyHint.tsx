// Small muted help text under a field or an empty list.
import type { ReactNode } from 'react'
import { MUTED } from './styles'

export type EmptyHintProps = {
  children: ReactNode
  className?: string
}

export function EmptyHint({ children, className }: EmptyHintProps) {
  return <p className={`${MUTED} ${className ?? ''}`}>{children}</p>
}
