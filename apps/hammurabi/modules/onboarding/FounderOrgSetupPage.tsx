import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useCreateFounderOrgSetup,
  useFounderSetupStatus,
} from '@modules/onboarding/hooks/useFounderOnboarding'
import {
  DEFAULT_FOUNDER_ORG_SETUP_FORM_VALUES,
  validateFounderOrgSetupFormValues,
  type FounderOrgSetupFormValues,
  type FounderOrgSetupValidationErrors,
} from '@modules/onboarding/contracts'

function formatSetupError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unable to create the founder and organization.'
  }

  const payload = error.message.match(/^Request failed \(\d+\): (.+)$/)?.[1]
  if (!payload) {
    return error.message
  }

  try {
    const parsed = JSON.parse(payload) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : error.message
  } catch {
    return error.message
  }
}

export function FounderOrgSetupPage() {
  const navigate = useNavigate()
  const setupStatus = useFounderSetupStatus()
  const mutation = useCreateFounderOrgSetup()
  const submissionLockRef = useRef(false)
  const defaultsAppliedRef = useRef(false)
  const hasEditedRef = useRef(false)
  const [formState, setFormState] = useState<FounderOrgSetupFormValues>(
    () => setupStatus.data?.defaultValues ?? DEFAULT_FOUNDER_ORG_SETUP_FORM_VALUES,
  )
  const [errors, setErrors] = useState<FounderOrgSetupValidationErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!setupStatus.data || defaultsAppliedRef.current || hasEditedRef.current) {
      return
    }

    defaultsAppliedRef.current = true
    setFormState(setupStatus.data.defaultValues)
  }, [setupStatus.data])

  function updateField<K extends keyof FounderOrgSetupFormValues>(key: K, value: FounderOrgSetupFormValues[K]) {
    hasEditedRef.current = true
    setFormState((current) => ({
      ...current,
      [key]: value,
    }))
    setErrors((current) => ({
      ...current,
      [key]: undefined,
    }))
    setSubmitError(null)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submissionLockRef.current) {
      return
    }

    const nextErrors = validateFounderOrgSetupFormValues(formState)
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) {
      return
    }

    submissionLockRef.current = true
    setSubmitError(null)
    try {
      const result = await mutation.mutateAsync({
        displayName: formState.orgDisplayName.trim(),
        founder: {
          displayName: formState.founderDisplayName.trim(),
          email: formState.founderEmail.trim(),
        },
      })
      navigate(result.nextRoute, { replace: true })
    } catch (error) {
      setSubmitError(formatSetupError(error))
    } finally {
      submissionLockRef.current = false
    }
  }

  const isSubmitting = mutation.isPending || submissionLockRef.current

  return (
    <div className="flex min-h-screen items-center justify-center bg-washi-aged px-4 py-10">
      <div className="card-sumi w-full max-w-xl p-8 md:p-10">
        <div className="text-center">
          <h1 className="font-display text-display text-sumi-black">
            Welcome to Hervald
          </h1>
          <p className="mt-3 text-sm text-sumi-diluted">
            Create your founder profile and organization to unlock the Command Room.
          </p>
        </div>

        <div className="divider-ink my-8" />

        <form className="space-y-5" onSubmit={handleSubmit} data-testid="founder-org-setup-form">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-sumi-black">Org display name</span>
            <input
              data-testid="org-display-name-input"
              type="text"
              value={formState.orgDisplayName}
              onChange={(event) => updateField('orgDisplayName', event.target.value)}
              className="w-full rounded-lg border border-ink-border bg-washi-white px-4 py-3 text-sumi-black focus:outline-none focus:ring-2 focus:ring-sumi-black/10"
              autoComplete="organization"
              autoFocus
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.orgDisplayName)}
            />
            {errors.orgDisplayName ? (
              <p className="text-sm text-accent-vermillion" role="alert">{errors.orgDisplayName}</p>
            ) : null}
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-sumi-black">Founder display name</span>
            <input
              data-testid="founder-display-name-input"
              type="text"
              value={formState.founderDisplayName}
              onChange={(event) => updateField('founderDisplayName', event.target.value)}
              className="w-full rounded-lg border border-ink-border bg-washi-white px-4 py-3 text-sumi-black focus:outline-none focus:ring-2 focus:ring-sumi-black/10"
              autoComplete="name"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.founderDisplayName)}
            />
            {errors.founderDisplayName ? (
              <p className="text-sm text-accent-vermillion" role="alert">{errors.founderDisplayName}</p>
            ) : null}
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-sumi-black">Founder email</span>
            <input
              data-testid="founder-email-input"
              type="email"
              value={formState.founderEmail}
              onChange={(event) => updateField('founderEmail', event.target.value)}
              className="w-full rounded-lg border border-ink-border bg-washi-white px-4 py-3 text-sumi-black focus:outline-none focus:ring-2 focus:ring-sumi-black/10"
              autoComplete="email"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.founderEmail)}
            />
            {errors.founderEmail ? (
              <p className="text-sm text-accent-vermillion" role="alert">{errors.founderEmail}</p>
            ) : null}
          </label>

          {submitError ? (
            <div className="rounded-lg border border-accent-vermillion/25 bg-accent-vermillion/5 px-4 py-3 text-sm text-accent-vermillion" role="alert">
              {submitError}
            </div>
          ) : null}

          <button
            type="submit"
            data-testid="founder-org-setup-submit"
            className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save and continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
