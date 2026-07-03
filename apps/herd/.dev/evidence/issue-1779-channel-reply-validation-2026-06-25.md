# Issue 1779 Channel Reply Validation

Date: 2026-06-25
Branch: `feature/issue-1779-herd-channels-shared-automatic`
Base: `origin/dev` at `9c006d66241f7e41ee493e54d36f4939fe608711`

## Scope

Durable automatic channel replies now record a channel reply intent when a channel-originated user message is accepted, then settle that intent through the same outbound channel reply path used by manual replies. A single latest `channelReplyDelivery` remains the visible delivery-state slot, but automatic claims serialize only active pending deliveries so concurrent replies and orphan stale slots do not overwrite or block each other.

```
╔══════════════════╗      ╔════════════════════╗      ╔══════════════════════╗
║ inbound provider ║  →   ║ idempotency ledger ║  →   ║ conversation intent  ║
╚══════════════════╝      ╚════════════════════╝      ╚══════════════════════╝
           │                         │                            │
           │                         │                            ↓
           │                         │              ╔════════════════════════╗
           └─────────────────────────┴──────────→   ║ transcript reconciler  ║
                                                     ╚════════════════════════╝
                                                                  │
                                                                  ↓
                                                     ╔════════════════════════╗
                                                     ║ channel reply delivery ║
                                                     ╚════════════════════════╝
```

## Local Service Proof

Validation ran against an isolated local data root:

- `HERD_DATA_DIR=/tmp/herd-issue-1779`
- API: `http://127.0.0.1:22179`
- Web: `http://localhost:5201`

Seeded channel conversation:

- Commander: `fc1379f8-f763-4c12-9bbe-6cca29384dbb`
- Conversation: `da25f3c1-d798-403d-b0b9-81aec8685674`
- Provider/account: `whatsapp` / `default`
- Raw source id: `issue-1779-validation-1782398437`
- Client send id: `channel:whatsapp:default:issue-1779-validation-1782398437`
- Assistant text: `Issue 1779 validation reply 2026.`

API readback confirmed:

- `channelReplyIntent.status = failed`
- `channelReplyIntent.deliveryId = channel-reply-da25f3c1-validation-1`
- `channelReplyDelivery.status = failed`
- `channelReplyDelivery.provider = whatsapp`
- `channelReplyDelivery.sessionKey = whatsapp:default:direct:15551234567@s.whatsapp.net`
- `channelReplyDelivery.lastRoute.to = 15551234567@s.whatsapp.net`
- `channelReplyDelivery.error = WhatsApp adapter offline in local validation`

The local WhatsApp adapter was intentionally unpaired, so terminal `failed` delivery is the expected local proof path. The UI displayed the same assistant text from the canonical transcript and the visible delivery failure notice.

## Screenshots

- Desktop Command Room: `apps/herd/.dev/evidence/issue-1779-screenshots/desktop-command-room-channel-reply.png`
- Mobile Command Room: `apps/herd/.dev/evidence/issue-1779-screenshots/mobile-command-room-channel-reply.png`

## Automated Verification

Focused regression suite:

```bash
pnpm --filter herd exec vitest run \
  modules/commanders/routes/__tests__/conversation-runtime.test.ts \
  modules/commanders/__tests__/channel-message-routes.test.ts
```

Review follow-up found additional edge cases after the first PR push:

- Claimed pending deliveries could remain stranded if the process died before delivered/failed settlement.
- Assistant turns with no deliverable final text could leave intents pending forever.
- A second automatic reply could overwrite the single pending `channelReplyDelivery` while the first adapter send was still in flight.
- A stale orphan `channelReplyDelivery[pending]` with no owning in-flight send or pending intent could block all later automatic reply claims.

Follow-up fixes:

- Track active provider sends in process so reconciliation does not race a live dispatch.
- Fail abandoned claimed deliveries with visible route/error metadata when no live dispatch owns the pending delivery.
- Fail no-text/unsuccessful assistant turns instead of leaving pending intents.
- Preserve a pending delivery slot while an active in-flight send or pending intent owns it.
- Allow newer intents to claim over orphan pending delivery slots that have no active owner.
- Add regressions for abandoned claimed deliveries, no-text reconciliation, concurrent replies, and orphan pending delivery slots.

Channel critical verification bundle:

```bash
pnpm --filter herd exec vitest run \
  modules/channels/__tests__/inbound-roundtrip.test.ts \
  modules/channels/__tests__/outbound.test.ts \
  modules/channels/__tests__/resolver.test.ts \
  modules/channels/__tests__/surface-binding-store.test.ts \
  modules/channels/__tests__/whatsapp-adapter.test.ts \
  modules/channels/__tests__/whatsapp-route.test.ts \
  modules/channels/__tests__/route.test.ts \
  modules/channels/__tests__/useChannels.test.tsx \
  modules/commanders/__tests__/channel-message-routes.test.ts \
  modules/commanders/routes/__tests__/conversation-runtime.test.ts \
  modules/commanders/routes/__tests__/conversation-read-model.test.ts \
  modules/agents/messages/__tests__/history.test.ts \
  modules/agents/components/session-message-list/__tests__/blocks.test.tsx \
  modules/command-room/__tests__/chat-pane.test.ts \
  modules/conversation/__tests__/use-conversations-message.test.tsx
```

Result after current PR follow-up: 15 files, 142 tests passed.

Full local gates:

```bash
git diff --check
pnpm --filter herd run docs:check
pnpm --filter herd run build
make fmt
make test
make lint
```

Results:

- `git diff --check`: passed.
- `pnpm --filter herd run docs:check`: passed.
- `pnpm --filter herd run build`: passed; Vite emitted existing chunk-size/dynamic-import warnings only.
- `make fmt`: passed; root formatter is not configured, so it is a no-op.
- `make test`: passed; 353 files passed, 1 skipped; 2271 tests passed, 13 skipped.
- `make lint`: passed.
- Focused `modules/commanders/routes/__tests__/conversation-runtime.test.ts`: passed with 21 tests, including abandoned delivery, no-text, concurrent reply, and orphan pending-slot regressions.
