// Label left, control right. Wraps to a full-width control on very narrow panels.
import type { ReactNode } from 'react'
import { MUTED } from './styles'

export type FieldRowProps = {
  label: string
  /** Id of the control, so clicking the label focuses it. */
  htmlFor?: string
  /** Second, muted line under the label. */
  hint?: string
  /** Label width on wide panels (default `w-24`). */
  labelWidth?: string
  children: ReactNode
  className?: string
}

export function FieldRow({ label, htmlFor, hint, labelWidth = 'w-24', children, className }: FieldRowProps) {
  const labelCls = `shrink-0 text-xs text-slate-500 dark:text-slate-400 ${labelWidth}`
  const labelContent = (
    <>
      {label}
      {hint && <span className={`block font-normal ${MUTED}`}>{hint}</span>}
    </>
  )
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className ?? ''}`}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelCls}>
          {labelContent}
        </label>
      ) : (
        <span className={labelCls}>{labelContent}</span>
      )}
      <div className="min-w-32 flex-1">{children}</div>
    </div>
  )
}
