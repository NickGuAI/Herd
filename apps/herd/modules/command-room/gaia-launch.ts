import { fetchJson } from '@/lib/api'
import {
  buildSessionDraftImagesStorageKey,
  buildSessionDraftStorageKey,
} from '@modules/agents/page-shell/use-session-draft'
import { buildCommandRoomLaunchTarget } from '@modules/command-room/route-metadata'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'

interface GaiaOnboardingStatus {
  exists: boolean
  commanderId: string | null
  conversationId: string | null
  displayName: string
}

interface OnboardingStatusResponse {
  gaia: GaiaOnboardingStatus
}

interface StartConversationResponse {
  conversation: ConversationRecord
}

export interface GaiaLaunchDeps {
  fetchJsonImpl?: typeof fetchJson
  storage?: Pick<Storage, 'setItem' | 'removeItem'>
  location?: Pick<Location, 'assign'>
  gaiaNotReadyMessage?: string
  conversationUnavailableMessage?: string
}

function fetchOnboardingStatus(fetchJsonImpl: typeof fetchJson): Promise<OnboardingStatusResponse> {
  return fetchJsonImpl<OnboardingStatusResponse>('/api/onboarding/status')
}

function writeGaiaDraft(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  sessionName: string,
  prompt: string,
): void {
  storage.setItem(buildSessionDraftStorageKey(sessionName), prompt)
  storage.removeItem(buildSessionDraftImagesStorageKey(sessionName))
}

export async function openGaiaConversationWithDraft(
  prompt: string,
  deps: GaiaLaunchDeps = {},
): Promise<void> {
  const fetchJsonImpl = deps.fetchJsonImpl ?? fetchJson
  const storage = deps.storage ?? window.localStorage
  const location = deps.location ?? window.location
  const status = await fetchOnboardingStatus(fetchJsonImpl)
  const { gaia } = status
  if (!gaia.exists || !gaia.commanderId) {
    throw new Error(deps.gaiaNotReadyMessage ?? 'Gaia is not ready. Finish onboarding before using Gaia for setup.')
  }

  const createdConversation = await fetchJsonImpl<ConversationRecord>(
    `/api/commanders/${encodeURIComponent(gaia.commanderId)}/conversations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'ui' }),
    },
  )
  const startedConversation = await fetchJsonImpl<StartConversationResponse>(
    `/api/conversations/${encodeURIComponent(createdConversation.id)}/start`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
  const conversation = startedConversation.conversation
  const sessionName = conversation.sendTarget?.sessionName
  if (!sessionName) {
    throw new Error(deps.conversationUnavailableMessage ?? 'Gaia conversation is unavailable.')
  }

  writeGaiaDraft(storage, sessionName, prompt)
  location.assign(buildCommandRoomLaunchTarget({
    commanderId: gaia.commanderId,
    conversationId: conversation.id,
  }).path)
}
