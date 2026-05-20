import { createApiKeysRouter } from '../../server/routes/api-keys.js'
import {
  ProviderSecretsStore,
} from '../../server/api-keys/provider-secrets-store.js'
import {
  API_KEY_SCOPES,
} from '../../server/api-keys/store.js'
import {
  initializeInboundTranscriptionProvider,
} from '../../server/voice/stt.js'
import {
  initializeOutboundSpeechSynthesizer,
} from '../../server/voice/tts.js'
import {
  isApiKeyManagementStore,
  type ModuleRouteRegistration,
  type ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createApiKeysRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { capabilities, options } = context
  const providerSecretsStore = options.providerSecretsStore ?? new ProviderSecretsStore()

  capabilities.provide('auth.api-keys', 'api-keys', {
    store: options.apiKeyStore,
    scopes: API_KEY_SCOPES,
  })
  capabilities.provide('api-key-store', 'api-keys', options.apiKeyStore)
  capabilities.provide('settings.provider-secrets', 'api-keys', providerSecretsStore)
  capabilities.provide('provider-secrets-store', 'api-keys', providerSecretsStore)
  capabilities.provide('realtime.transcription-key-store', 'api-keys', options.transcriptionKeyStore)

  initializeInboundTranscriptionProvider({ providerSecretsStore })
  initializeOutboundSpeechSynthesizer({ providerSecretsStore })

  return {
    name: 'api-keys',
    routeIds: ['api-keys.api'],
    router: createApiKeysRouter({
      store: isApiKeyManagementStore(options.apiKeyStore) ? options.apiKeyStore : undefined,
      providerSecretsStore,
      domain: options.auth0Domain,
      audience: options.auth0Audience,
      clientId: options.auth0ClientId,
    }),
  }
}
