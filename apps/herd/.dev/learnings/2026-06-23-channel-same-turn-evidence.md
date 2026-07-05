# 2026-06-23 Channel Same-Turn Evidence

Incident: channel fixes were declared close to done using evidence gathered from
different layers, but not always from the same conversation turn. That allowed
the team to prove external delivery, raw transcript text, copy text, and UI
rendering as separate facts while still missing that the actual channel-visible
turn was broken.

Cause: the review process did not force a same-turn trace. Channel behavior is
not a single module behavior. It is the composition of provider adapter,
surface binding, conversation runtime, runtime session state, transcript
windowing, message projection, automatic outbound dispatch, delivery state, and
desktop/mobile rendering.

Lesson: for channel-impacting changes, future agents must capture evidence for
one external peer, one `conversationId`, and one assistant reply text across all
critical layers:

- inbound provider event accepted.
- surface binding and `sessionKey` resolve to the intended conversation.
- session create/resume/send works after relaunch and active/no-live recovery.
- transcript JSONL persists the assistant turn.
- `/api/conversations/:id/messages` projects the same text in correct order.
- `dispatchCommanderChannelReply` sends the same final text once.
- external provider receives the same text.
- desktop and mobile Command Room visibly render the same text.
- copy/export preserves the same raw text.
- `channelReplyDelivery`, `channelMeta`, and `lastRoute` remain coherent.

If any layer uses evidence from a different turn, the channel-impact review is
not complete.

Primary sources:

- `apps/herd/.dev/playbooks/channel-impacting-change.md`
- `apps/herd/.dev/VERIFY.md`
- `apps/herd/.dev/maps/channels.md`
