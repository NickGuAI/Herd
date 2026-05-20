import type { OrgIdentity } from '../org-identity/types.js'
import type { Operator } from '../operators/types.js'

export const FOUNDER_SETUP_PATH = '/welcome'
export const FOUNDER_SETUP_COMPLETED_PATH = '/org'
export const FOUNDER_SETUP_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export interface FounderOrgSetupFormValues {
  orgDisplayName: string
  founderDisplayName: string
  founderEmail: string
}

export interface FounderOrgSetupValidationErrors {
  orgDisplayName?: string
  founderDisplayName?: string
  founderEmail?: string
}

export const DEFAULT_FOUNDER_ORG_SETUP_FORM_VALUES: FounderOrgSetupFormValues = {
  orgDisplayName: '',
  founderDisplayName: '',
  founderEmail: '',
}

export interface FounderOrgSetupRequest {
  displayName: string
  founder: {
    displayName: string
    email: string
  }
}

export interface FounderOrgSetupResponse {
  operator: Operator
  orgIdentity: OrgIdentity
  nextRoute: string
}

export interface FounderSetupStatus {
  setupComplete: boolean
  defaultValues: FounderOrgSetupFormValues
  validationErrors: FounderOrgSetupValidationErrors
  nextRoute: string
}

export function validateFounderOrgSetupFormValues(
  state: FounderOrgSetupFormValues,
): FounderOrgSetupValidationErrors {
  const orgDisplayName = state.orgDisplayName.trim()
  const founderDisplayName = state.founderDisplayName.trim()
  const founderEmail = state.founderEmail.trim()
  const errors: FounderOrgSetupValidationErrors = {}

  if (!orgDisplayName) {
    errors.orgDisplayName = 'Org display name is required.'
  }

  if (!founderDisplayName) {
    errors.founderDisplayName = 'Founder display name is required.'
  }

  if (!founderEmail) {
    errors.founderEmail = 'Founder email is required.'
  } else if (!FOUNDER_SETUP_EMAIL_PATTERN.test(founderEmail)) {
    errors.founderEmail = 'Founder email must be a valid email address.'
  }

  return errors
}
