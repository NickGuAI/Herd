import type { ReactNode } from 'react'

interface FieldProps {
  label: string
  htmlFor?: string
  required?: boolean
  error?: string | null
  children: ReactNode
}

export function Field({
  label,
  htmlFor,
  required = false,
  error = null,
  children,
}: FieldProps) {
  return (
    <label htmlFor={htmlFor} className="block space-y-2">
      <span className="block text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
      {error ? (
        <span className="block text-sm text-[color:var(--hv-accent-danger)]">{error}</span>
      ) : null}
    </label>
  )
}
