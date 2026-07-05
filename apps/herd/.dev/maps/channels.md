# Channels And External Conversations

## Purpose

Channels connects external providers such as WhatsApp, email, Slack, Discord,
Telegram, and Google Chat to commander conversations. It owns provider account
bindings, adapter runtimes, surface binding, inbound normalization, and
provider-specific outbound sends. Commanders owns the public channel ingest and
reply routes because those routes resolve into commander conversations.

## Source Files

- `apps/herd/modules/channels/runtime.ts`
- `apps/herd/modules/channels/runtime-manager.ts`
- `apps/herd/modules/channels/registry.ts`
- `apps/herd/modules/channels/store.ts`
- `apps/herd/modules/channels/resolver.ts`
- `apps/herd/modules/channels/policy.ts`
- `apps/herd/modules/channels/drop-status.ts`
- `apps/herd/modules/channels/types.ts`
- `apps/herd/modules/channels/surface-binding-store.ts`
- `apps/herd/modules/channels/surface-key.ts`
- `apps/herd/modules/channels/route.ts`
- `apps/herd/modules/channels/types.ts`
- `apps/herd/modules/channels/page.tsx`
- `apps/herd/modules/channels/hooks/useChannels.ts`
- `apps/herd/modules/channels/whatsapp/adapter.ts`
- `apps/herd/modules/channels/whatsapp/baileys-transport.ts`
- `apps/herd/modules/channels/email/adapter.ts`
- `apps/herd/modules/channels/slack/adapter.ts`
- `apps/herd/modules/channels/discord/adapter.ts`
- `apps/herd/modules/channels/telegram/adapter.ts`
- `apps/herd/modules/channels/googlechat/adapter.ts`
- `apps/herd/server/module-manifest.ts`
- `apps/herd/modules/commanders/routes/register-conversations.ts`
- `apps/herd/modules/commanders/routes/register-channels.ts`
- `apps/herd/modules/commanders/routes/conversation-runtime.ts`
- `apps/herd/modules/commanders/routes/context.ts`
- `apps/herd/modules/commanders/conversation-store.ts`
- `apps/herd/modules/commanders/channel-dispatchers.ts`
- `apps/herd/modules/agents/transcript-store.ts`
- `apps/herd/modules/agents/messages/canonical-timeline.ts`
- `apps/herd/modules/agents/messages/history.ts`
- `apps/herd/modules/agents/components/session-message-list/blocks.tsx`
- `apps/herd/docs/architecture/channels.md`

## Owned State/Data

- channels: provider account bindings, runtime manager state, channel provider
  descriptors, inbound provider config, surface binding records, provider auth
  material references, and per-binding pre-ingest drop status
  (`dropCount`, `recentDrops`, `lastDrop`).
- commanders: conversation records, `channelMeta`, `lastRoute`,
  `channelReplyIntents`, `channelReplyDelivery`, `channelInboundFates`, and
  `/api/commanders/channel-message` / `/api/commanders/:id/channel-reply`
  behavior.
- agents: provider session events, transcript JSONL, projected message items,
  and shared chat rendering.

## External Surfaces

- `/channels`
- `/api/commanders/:id/channels`
- `/api/commanders/channel-message`
- `/api/commanders/:id/channel-reply`
- `/api/conversations/:id`
- `/api/conversations/:id/messages`
- `/api/conversations/:id/ws`
- provider webhooks, pollers, and transports.

## Critical Review Path

```text
Provider inbound event
        |
        v
Adapter normalizes ChannelInboundEvent
        |
        v
/api/commanders/channel-message
        | parse/resolve/policy failure
        +--> adapter drop feed: policy-denied | ingest-failed
        |
        v
Resolver chooses commander + conversation surface
        | duplicate/ingest failure after conversation exists
        +--> conversation.channelInboundFates: duplicate | ingest-failed
        |
        v
Conversation runtime sends user message to provider session
        |
        v
Assistant turn writes transcript events
        |
        +--> channelReplyIntent persists expected automatic reply
        |       |
        |       v
        |   forwarder/reconciler extracts final assistant text
        |       |
        |       v
        |   channelReplyDelivery claims one active provider send
        |       |
        |       v
        |   channel dispatcher sends provider reply and settles intent
        |       |
        |       +--> conversation.channelInboundFates: replied | turn-failed
        |
        v
mapStreamEventsToMessages + channel fate projection build Command Room messages
        |
        v
SessionMessageList renders visible transcript
```

Do not collapse these into one check. External provider success, transcript raw
text, copy-button success, and visible Command Room rendering are separate
observable outcomes.

Provider runtime health is also a separate observable outcome. A successful
`/api/health` response after production relaunch can hide an initial crash if a
supervisor restarted the server. For channel-impacting production fixes, inspect
the active launch logs for adapter startup, reconnect/auth failures, unhandled
rejections, and crash restarts before declaring the channel path healthy.

## Critical Review Inventory

When a channel change is open, review these pieces as one product path:

- provider adapter/runtime: account startup, inbound normalization, outbound
  `send`, provider-specific failure reporting, and pre-ingest drop feed writes.
- request body parsing: `/api/commanders/channel-message` must use the dedicated
  channel-message JSON parser, not the default 100 KB Express parser.
- channel resolver and surface-binding store: commander target, conversation
  target, `sessionKey`, peer identity, WhatsApp group JID normalization, and
  WhatsApp LID-to-phone alias behavior.
- commander conversation runtime: create/resume, `sendToSession`, durable
  `channelReplyIntents`, `channelReplyForwarders`, reconciliation,
  completed-turn skipping, delivery-state writes, sender-facing turn-failure
  notices, and `channelInboundFates`.
- provider adapter contract: `supportsMessageEdit` and optional `editMessage`
  are adapter capabilities. Streaming consumers must not platform-sniff.
- transcript/event schema: legacy `message_start`/`result` events and
  schema-v2 transcript envelopes must both be considered when production can
  emit both.
- provider turn sequencing: Claude and Codex both synthesize visible user
  envelopes with `clientSendId` but no `turnId`; Codex then emits protocol
  `turnId` on provider turn events and can steer into an active turn. See
  `apps/herd/.dev/learnings/2026-06-24-claude-codex-channel-turn-sequencing.md`.
- transcript storage/windowing: tail pages, canonical ordering, legacy
  unsequenced rows, and live-vs-persisted merging must keep the user and
  assistant turn order stable after resume/reload.
- message projection: `mapStreamEventsToMessages` must produce the same final
  assistant text that outbound reply dispatch uses.
- read model/API: `/api/conversations/:id`, `/api/conversations/:id/messages`,
  and websocket replay must agree with stored transcript state.
- visible UI: desktop and mobile Command Room must visibly render the projected
  assistant text; raw copy/export success is not enough.
- delivery state: `channelReplyDelivery`, `channelReplyIntents`, `channelMeta`,
  `lastRoute`, `channelInboundFates`, and surface binding must stay coherent
  after reload/resume. A pending delivery is blocking only while an in-flight send
  owns it or a pending intent references its delivery id; orphan pending delivery
  slots must not block newer intents.
- progressive outbound dispatch: edit-capable text replies post once, edit
  partials at a throttle, and force-edit the final canonical transcript text.
  Non-edit-capable, media, voice, and gated replies stay final-only.
- WhatsApp reconnect behavior: Baileys `messages.upsert` handling must ignore
  non-`notify` history replay events before downloading media or POSTing ingest.
- same-turn evidence: one external peer, one `conversationId`, and one
  assistant reply text must be traced through transcript JSONL, message API,
  external provider delivery, desktop UI, mobile UI, copy/export, and delivery
  status.
- relaunch health: the active server log must show no unexplained channel
  adapter startup failure, provider auth failure, unhandled rejection, reconnect
  loop, or crash restart after the deploy being verified.

Use `apps/herd/.dev/playbooks/channel-impacting-change.md` for the
required stop-the-line rules and evidence template.

## Verification Bundle

Use the `Channels And External Conversation Surfaces` bundle in
`apps/herd/.dev/VERIFY.md`.

## Known Risks / Open Questions

- A provider reply can be delivered while the Command Room transcript still
  renders incorrectly because copy/raw text bypasses Markdown rendering.
- Automatic channel reply dispatch must preserve the durable-intent contract:
  record the intent before live-session handoff, key reconciliation by
  `clientSendId`, support schema-v2 transcript envelopes, serialize active
  pending deliveries, and settle missed/interrupted/no-text turns as delivered or
  failed instead of leaving pending intents behind.
- A supervised production relaunch can look healthy after a restart while the
  first process died from a provider adapter/runtime failure. Treat launch-log
  inspection as part of channel verification, not an optional ops check.
- A channel conversation must preserve `channelMeta`, `lastRoute`, and surface
  binding state across resume/reload, or replies can route to the wrong external
  peer.
- Account binding chooses the commander; surface binding chooses the
  conversation. Do not use runtime startup binding as a general commander
  ownership proof.
- Inbound voice/audio changes also touch STT/TTS and need provider-specific
  adapter tests plus visible transcript review.
