# 2026-06-23 Channel Critical Review Packet

Incident: a channel-impacting fix passed several isolated checks, but the full
user path was still broken. The assistant reply existed as raw text and could
be copied, and WhatsApp delivery later worked, but visible Command Room
rendering failed for the same channel turn. Separately, production relaunch
health could look clean from `/api/health` while an earlier supervised process
had crashed during provider runtime startup.

Cause: the process did not require a single auditable review packet before
declaring done. The work was reviewed by module and symptom instead of by the
external-channel product path.

Lesson: channel-impacting changes must be signed off with the `Channel Critical
Review Packet` in `apps/herd/.dev/playbooks/channel-impacting-change.md`.
The packet must trace one external peer, one `conversationId`, and one assistant
reply text across provider runtime, surface binding, conversation runtime,
transcript storage, message projection, automatic outbound dispatch, external
delivery, desktop/mobile visible UI, copy/export, delivery state, and active
launch-log health.

Do not declare a channel fix done when the evidence is stitched together from
different turns, different conversations, or only raw/provider layers. A
successful `/api/health` response is not enough for production channel changes;
inspect the current launch log for provider adapter startup, auth/reconnect
errors, unhandled rejections, and crash restarts.

Primary sources:

- `apps/herd/.dev/playbooks/channel-impacting-change.md`
- `apps/herd/.dev/VERIFY.md`
- `apps/herd/.dev/maps/channels.md`
- `apps/herd/modules/commanders/routes/conversation-runtime.ts`
- `apps/herd/modules/commanders/channel-dispatchers.ts`
- `apps/herd/modules/agents/messages/history.ts`
- `apps/herd/modules/agents/components/session-message-list/blocks.tsx`
