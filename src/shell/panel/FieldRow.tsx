// Label left, control right. Wraps to a full-width control on very narrow panels.
// Label = 12 px medium slate-300, hint = 12 px regular slate-400 (L2/L3 of the design audit):
// one step of hierarchy between the two, both readable on the dark surface.
import type { ReactNode } from 'react'
import { HINT, LABEL } from './styles'

export type FieldRowProps = {
  label: string
  /** Id of the control, so clicking the label focuses it. */
  htmlFor?: string
  /** Second, muted line under the label. */
  hint?: string
  /** Label width on wide panels (default `w-20`). */
  labelWidth?: string
  children: ReactNode
  className?: string
  /** Label above, control at full width. Use for segmented controls with long labels. */
  stacked?: boolean
}

export function FieldRow({ label, htmlFor, hint, labelWidth = 'w-20', children, className, stacked }: FieldRowProps) {
  const labelCls = `${LABEL} ${stacked ? 'w-full' : labelWidth} shrink-0`
  const labelContent = (
    <>
      {label}
      {hint && <span className={`block ${HINT}`}>{hint}</span>}
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
      <div className={stacked ? 'w-full' : 'min-w-0 flex-1 basis-24'}>{children}</div>
    </div>
  )
}
