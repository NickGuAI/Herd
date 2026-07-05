# Channel Integration Guide

This guide documents the current WhatsApp channel path end to end and the reusable pattern for future Herd channels.

Use it when adding or fixing WhatsApp, email, Telegram, Discord, iMessage, LinkedIn relay, or any other external surface that should talk to a commander conversation.

## The Mental Model

Channels are not commanders and they are not conversations. A channel is an external account plus transport that can create or reuse a conversation when a real external surface sends a message.

```
External surface       Account binding          Surface binding          Conversation          Runtime session
person / group   ->    channel account    ->    peer/thread route   ->   commander chat   ->   agent runtime
```

Definitions:

- `ChannelAdapter`: provider-specific implementation. It knows WhatsApp/Baileys, email/IMAP, etc.
- `CommanderChannelBinding`: account-level binding, persisted in `~/.herd/channels.json`. One row means "this commander owns this provider account".
- `ChannelSurfaceBinding`: peer-level binding, persisted in `~/.herd/channels/surface-bindings.json`. One row maps one external peer/thread to one conversation.
- `surfaceKey`: stable identity for one external surface: `provider:accountId:peerId` or `provider:accountId:peerId:threadId`.
- `channelMeta`: conversation metadata describing the external surface.
- `lastRoute`: the outbound address for replies.
- `runtime`: a live provider session, such as a Baileys socket or IMAP poller.
- `conversation runtime session`: the live commander agent session created from a conversation.

The important invariant: account binding chooses the commander; surface binding chooses the conversation. Do not move account bindings to "fix" a message route unless the account is actually owned by the wrong commander.

## Provider Onboarding Checklist

The `/channels` modal uses provider descriptors for both form fields and setup
guides. When adding or changing a provider, keep the guide close to the
descriptor so the operator sees the setup steps before saving the binding.

Email:

- Use a dedicated mailbox when possible.
- Enable IMAP and SMTP with TLS, then create an app password or mailbox
  credential.
- Fill the mailbox account id, username, from/reply-from addresses, IMAP host
  and port, SMTP host and port, plus alias, and sender allowlists.
- Send the first real inbound email from an allowed address; that message creates
  or reuses the commander conversation and replies through SMTP.

WhatsApp:

- Use a stable WhatsApp account and connect Herd as a Baileys Linked Device.
- Start pairing from `/channels`, scan the QR from WhatsApp Linked Devices, and
  keep the phone and page open until status is connected.
- Choose direct and group policies deliberately. WhatsApp group allowlists use
  group ids ending in `@g.us`; direct allowlists can use phone numbers with
  country code or WhatsApp JIDs.
- The first allowed inbound DM or group message creates or reuses the commander
  conversation.

Google Chat:

- Create a Google Chat app, enable the Google Chat API, create a service account,
  and paste the service-account JSON into the binding.
- Point Chat events at `/api/commanders/channels/googlechat/events`; add
  `accountId` or `commanderId` query parameters only when one app maps to
  multiple bindings.
- Set webhook audience and audience type to match Google's event bearer token.
- Paste the bot user resource, such as `users/123456789`, when space mention
  enforcement must work before the first event proves the bot identity.
- Space allowlists use resource names such as `spaces/AAAA`.

Slack:

- Create a Slack app, enable Socket Mode, create an app-level token with
  `connections:write`, and save the bot token after installing the app.
- Add bot OAuth scopes `app_mentions:read`, `channels:history`,
  `groups:history`, `im:history`, `mpim:history`, and `chat:write`.
- Open Event Subscriptions, enable events, and subscribe the bot to
  `app_mention`, `message.im`, `message.channels`, `message.groups`, and
  `message.mpim`.
- Invite the app into each Slack channel with `/invite @bot-name`.
- New Slack bindings default to `groupPolicy: "open"` with
  `requireMention: true`, so the first `@bot` message in an invited channel is
  actionable while unmentioned channel messages are ignored.
- Slack policy denials are observable through logs and channel status metadata
  `lastDeniedInbound.reason`, including `group-disabled`, `allowlist-deny`, and
  `mention-required`.

## Current WhatsApp Architecture

```
┌──────────────────────┐
│ WhatsApp mobile app  │
│ linked device / QR   │
└──────────┬───────────┘
           │ Baileys socket events
           v
┌──────────────────────────────────────────────┐
│ modules/channels/whatsapp/baileys-transport │
│ - QR pairing                                 │
│ - reconnect after Baileys 515 pairing close  │
│ - normalize message into ChannelInboundEvent │
│ - accept trusted self-chat                   │
│ - suppress Herd outbound echo           │
└──────────┬───────────────────────────────────┘
           │ onInbound(event)
           v
┌──────────────────────────────────┐
│ modules/channels/whatsapp/adapter │
│ POST /api/commanders/channel-message          │
│ x-herd-internal-token                    │
└──────────┬───────────────────────────────────┘
           │ internal authenticated ingest
           v
┌───────────────────────────────────────┐
│ modules/commanders/routes/register-channels │
│ parse -> resolve -> voice preflight -> deliver │
└──────────┬────────────────────────────┘
           │
           v
┌─────────────────────────────────────┐
│ modules/channels/resolver.ts        │
│ account binding + surface binding   │
│ creates/reuses conversation          │
└──────────┬──────────────────────────┘
           │
           v
┌──────────────────────────────────────────────┐
│ modules/commanders/routes/conversation-runtime │
│ auto-start idle channel conversations         │
│ send inbound text to live session             │
│ subscribe to assistant result events          │
└──────────┬───────────────────────────────────┘
           │ assistant result
           v
┌──────────────────────────────────────┐
│ modules/commanders/channel-dispatchers.ts │
│ surface binding -> adapter.send()          │
└──────────┬─────────────────────────────────┘
           │
           v
┌──────────────────────────────────┐
│ WhatsApp adapter -> Baileys send │
└──────────────────────────────────┘
```

Related diagrams:

- `docs/diagrams/features/channels/channel-ideal-architecture.svg`
- `docs/diagrams/features/channels/channel-current-architecture.svg`
- `docs/diagrams/features/channels/whatsapp-pairing-herd-vs-openclaw.svg`

## What We Fixed For WhatsApp

### 1. Pairing works past the Baileys restart

Baileys can close a just-scanned QR socket with nested status `515`. That does not mean pairing failed. The transport now treats that as a pairing restart signal, replaces the socket once, keeps the pairing challenge alive, and lets the UI continue polling until the account is connected.

Files:

- `modules/channels/whatsapp/baileys-transport.ts`
- `modules/channels/whatsapp/adapter.ts`
- `modules/channels/__tests__/whatsapp-baileys-transport.test.ts`
- `modules/channels/__tests__/whatsapp-adapter.test.ts`

### 2. Self-chat can be used as an inbound WhatsApp surface

WhatsApp self-chat messages from the linked device arrive with `fromMe: true`, which normally means "ignore this so we do not ingest our own outbound replies." For self-chat, that rule was too broad.

The transport now accepts `fromMe` only when all are true:

- the chat is a direct WhatsApp JID;
- the remote JID matches the linked account's own JID or LID;
- the message id was not just produced by Herd outbound send.

Outbound messages sent by Herd are recorded in a small recent-message-id set, so their WhatsApp echo is suppressed.

### 3. Internal channel ingestion is authenticated correctly

WhatsApp adapters call `POST /api/commanders/channel-message` from inside the Herd process with `x-herd-internal-token`.

The commander runtime must pass `internalToken` into `createCommandersRouter`, and the route context must wire it into `combinedAuth`. If this is missing, inbound WhatsApp logs look like a transport problem, but the actual failure is `401/403` on the internal ingest route.

Files:

- `modules/commanders/runtime.ts`
- `modules/commanders/routes/context.ts`
- `modules/commanders/routes/types.ts`
- `modules/commanders/__tests__/channel-message-routes.test.ts`

### 4. Inbound messages create/reuse the right conversation

The first allowed inbound message from a WhatsApp peer creates:

- one `Conversation` with `creationSource: 'channel'`;
- one `ChannelSurfaceBinding` keyed by `provider:accountId:peerId[:threadId]`;
- a `channelMeta` snapshot on the conversation;
- a `lastRoute` snapshot for replies.

Later messages with the same surface key reuse the same conversation. Different account ids intentionally create different conversations even for the same phone number.

This is why the channel configuration page does not need a manual conversation picker for the normal case. The conversation is selected by the external surface that sends the message.

When that conversation is idle or newly created, the runtime must be started the same way as an explicit chat start:

- create the provider session with the commander `COMMANDER.md`/memory system prompt;
- send `STARTUP_PROMPT` first so the runtime enters the normal commander-start state;
- queue the inbound channel text behind that startup turn.

Do not use the inbound channel text as the session's first prompt. That skips the startup seed and makes channel-created conversations behave differently from UI-created chats.

### 5. Allowlist matching works with phone numbers

WhatsApp direct messages can appear as raw numbers, `@s.whatsapp.net` JIDs, or `@lid` identifiers. Direct-message allowlists compare the local-part digits, so a normal phone number can match a WhatsApp JID. Group allowlists are exact because group JIDs are not phone numbers.

Current policy behavior:

- `dmPolicy: 'open'`: any direct message for the account can create/use a conversation.
- `dmPolicy: 'allowlist'`: direct peer must match `dmAllowlist`, `allowlist`, or `globalAllowlist`.
- `groupPolicy: 'allowlist'`: group id must match `groupAllowlist`, `allowlist`, or `globalAllowlist`.
- `groupPolicy: 'disabled'`: groups are ignored.
- Trusted WhatsApp self-chat bypasses allowlist denial after it is identified as self-authored self-chat.

Files:

- `modules/channels/policy.ts`
- `modules/channels/whatsapp/config.ts`

### 6. Assistant replies are sent back automatically

Manual reply dispatch already existed through `POST /api/commanders/:id/channel-reply`, but auto-started channel conversations were missing a bridge from assistant output back to the channel.

The conversation runtime now records a durable `channelReplyIntent` before each accepted channel-originated send reaches the live session. The process-local channel reply forwarder subscribes to stream events, accumulates one assistant turn, extracts the latest agent text at `turn.end`, and calls `dispatchCommanderChannelReply`.

For auto-started channel conversations, the forwarder skips the startup turn. External channels should receive the reply to the inbound user text, not the runtime's readiness acknowledgement.

The reconciler is the durable fallback. It scans the live and persisted transcript tail for pending intent `clientSendId`s, claims the single latest `channelReplyDelivery` slot only when no active pending delivery owns it, and settles each intent as delivered or failed. Missed forwarder events, interrupted claimed sends, no-text assistant turns, and stale orphan delivery slots all have explicit regressions.

```text
channel message accepted
  -> channelReplyIntent[pending]
  -> live forwarder fast path or scheduled reconciler
  -> channelReplyDelivery[pending]
  -> adapter.send()
  -> channelReplyIntent[delivered|failed]
```

The forwarder is removed when a conversation session is stopped, replaced, failed to start, or the commander router is disposed. Pending intents remain persisted so reconciliation can continue after the fast path is gone.

Files:

- `modules/commanders/routes/conversation-runtime.ts`
- `modules/commanders/routes/context.ts`
- `modules/commanders/routes/index.ts`
- `modules/commanders/routes/register-channels.ts`
- `modules/commanders/channel-dispatchers.ts`

### 7. Voice notes are part of the shared channel contract

Adapters expose capability flags. WhatsApp sets `voiceNotes: true`.

Inbound voice:

- adapter normalizes audio into `ChannelInboundEvent.audio`;
- channel route runs STT preflight when the adapter supports voice notes;
- transcript is delivered to the conversation;
- transcript ledger is appended to the session transcript;
- failed STT drops the message rather than sending empty text.

Outbound voice:

- dispatcher resolves conversation voice config;
- if TTS is enabled and the adapter supports voice notes, it synthesizes audio;
- TTS failure falls back to text-only send.

## How To Pair WhatsApp

From the Channels page:

1. Select the commander that owns the WhatsApp account.
2. Select provider `WhatsApp`.
3. Enter a display name.
4. Optionally enter a stable account id. If blank, Herd generates `wa-...`.
5. Choose `Baileys QR`.
6. Set direct/group policy and allowlists.
7. Submit and scan the QR from WhatsApp Linked Devices.
8. Keep WhatsApp open while the status progresses to connected.
9. The binding is created and the runtime manager starts the account runtime.

State created:

- account binding: `~/.herd/channels.json`;
- Baileys auth state: under `~/.herd/commander/channels/whatsapp/<hashed-account>/auth`;
- runtime process memory: `ChannelAdapterRuntimeManager` keyed by `provider:accountId`.

If the server restarts, `ChannelAdapterRuntimeManager.startAll()` reloads enabled account bindings and restarts provider runtimes.

## How A Conversation Gets Connected

For WhatsApp, the conversation is connected by the first allowed inbound message.

```
Allowed WhatsApp message
  -> account binding found by provider/accountId
  -> surface key computed from provider/accountId/peerId/threadId
  -> existing surface binding reused, or new conversation created
  -> live commander conversation auto-started if idle with the normal startup seed
  -> inbound text queued behind startup when the session was auto-started
  -> inbound text sent directly or queued by mode when the session was already active
```

There is no separate "bind this WhatsApp account to this existing conversation" step in the current default flow. If a future product requirement needs explicit binding to an existing conversation, add it as an explicit UI action that creates/updates a `ChannelSurfaceBinding`; do not infer it from commander names or conversation names.

## Queue Semantics

Channel messages can arrive as `followup` or `collect`.

- `followup`: send immediately to an active conversation runtime.
- `collect`: enqueue with normal priority.

If a channel message auto-starts an idle conversation, the first inbound message is queued with normal priority even in followup mode. This preserves the startup seed ordering: commander identity and memory load first, then the external message is processed.

The UI invariant is:

- queued messages show in the Queue tab while waiting;
- queued messages do not appear in the chat panel until the runtime starts processing them;
- when a queued message is processed, it appears once as the user message for that turn.

Any future queue rendering fix should preserve that contract.

## Adding A Future Channel

Use this checklist.

1. Add provider config parsing under `modules/channels/<provider>/config.ts`.
2. Add an adapter under `modules/channels/<provider>/adapter.ts` implementing `ChannelAdapter`.
3. Normalize inbound provider payloads into `ChannelInboundEvent`.
4. Implement outbound `send(runtime, conversation, payload)` using `conversation.lastRoute` and/or the surface binding.
5. Register the adapter in `modules/channels/runtime.ts`.
6. Add UI fields to `modules/channels/page.tsx` only for provider/account configuration, not for hidden routing inference.
7. Use `CommanderChannelBinding` for account ownership and `ChannelSurfaceBinding` for peer/thread-to-conversation routing.
8. Use `checkAccountInboundPolicy` or extend it narrowly if the provider has special identity matching.
9. Reuse `/api/commanders/channel-message` for inbound and `dispatchChannelReply` for outbound.
10. If the adapter is in-process, use `x-herd-internal-token`; make sure the target router receives `internalToken`.
11. Add tests for pairing/config, inbound normalization, surface binding reuse, policy deny, outbound send, and auto reply dispatch.

Do not add provider-specific forks of commander conversation routes, session interfaces, or runtime session logic unless the shared contract is actually missing a concept.

## Troubleshooting Map

Pairing QR scans but never connects:

- Check `modules/channels/whatsapp/baileys-transport.ts` status handling.
- Look for Baileys 515 reconnect behavior.
- Confirm auth state directory is writable and inside the account data directory.

WhatsApp says connected but inbound does not appear:

- Confirm enabled account binding exists for the provider/account id.
- Confirm policy allows the peer or self-chat path.
- Check adapter POST to `/api/commanders/channel-message`.
- Check internal token auth on the commanders router.
- Check `surface-bindings.json` for the expected surface key.

Inbound creates the wrong commander conversation:

- Inspect account binding ownership in `channels.json`.
- Do not move the binding unless the WhatsApp account is actually owned by the wrong commander.
- Inspect `surface-bindings.json` for stale surface keys.

Inbound appears but assistant response does not go back:

- Confirm the conversation has `channelMeta` and `lastRoute`.
- Confirm `dispatchChannelReplies: true` is passed by channel ingest.
- Confirm a `channelReplyIntent` was recorded before live-session handoff.
- Confirm `ensureChannelReplyForwarder` is registered for the live session.
- Confirm `reconcileAutomaticChannelReplies()` can find the assistant turn for the intent `clientSendId`.
- Confirm a pending `channelReplyDelivery` is active only if an in-flight send owns it or a pending intent references its delivery id.
- Confirm the adapter is registered and `adapter.send()` can resolve an enabled account binding.

User message appears twice:

- Check whether one copy is queued UI state and the other is the processed runtime user event.
- Check whether the stream event machine renders `queued_message` both from replay and live stream without dedupe.
- Preserve the invariant that queued messages are visible in Queue only until processing starts.

Outbound response loops back as inbound:

- For WhatsApp, confirm recently sent message ids are recorded in the Baileys runtime.
- Confirm self-chat acceptance excludes recently sent ids.

## Regression Tests To Keep Green

Run the focused tests when changing channel behavior:

```bash
pnpm --filter herd exec vitest run modules/commanders/routes/__tests__/conversation-runtime.test.ts
pnpm --filter herd exec vitest run modules/commanders/__tests__/channel-message-routes.test.ts
pnpm --filter herd exec vitest run modules/channels/__tests__/whatsapp-adapter.test.ts modules/channels/__tests__/whatsapp-baileys-transport.test.ts modules/channels/__tests__/outbound.test.ts
```

Run the broader app gate before merging:

```bash
pnpm --filter herd run lint
pnpm --filter herd run build
```

The regressions this guide is meant to prevent:

- provider transport connected, but internal ingest route rejects the adapter;
- self-chat ignored as `fromMe`;
- outbound messages echoed back into inbound;
- account binding moved to the wrong commander instead of fixing surface routing;
- first inbound message creates multiple conversations for one surface;
- assistant results stay inside the web chat and never dispatch to the external channel;
- automatic replies remain pending after a missed subscriber, interrupted send, no-text assistant turn, concurrent delivery, or orphan delivery slot;
- queue state leaks into chat rendering before the message is actually processed.
