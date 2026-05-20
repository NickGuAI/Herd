interface ScheduleExpressionFieldProps {
  schedule: string
  onScheduleChange: (value: string) => void
  placeholder?: string
  helperText?: string
  required?: boolean
}

export function ScheduleExpressionField({
  schedule,
  onScheduleChange,
  placeholder = '0 2 * * *',
  helperText = 'Standard 5-field cron expression',
  required = true,
}: ScheduleExpressionFieldProps) {
  return (
    <div>
      <label className="section-title block mb-2">Schedule</label>
      <input
        value={schedule}
        onChange={(event) => onScheduleChange(event.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] font-mono text-[16px] md:text-sm focus:outline-none focus:border-[color:var(--hv-border-soft)]"
        placeholder={placeholder}
        required={required}
      />
      {helperText ? (
        <p className="mt-1 text-whisper text-[color:var(--hv-fg-faint)]">{helperText}</p>
      ) : null}
    </div>
  )
}
