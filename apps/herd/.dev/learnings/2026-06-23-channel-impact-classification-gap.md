# 2026-06-23 Channel Impact Classification Gap

Incident: channel-facing fixes were reviewed as separate local bugs. One fix
proved automatic outbound delivery, then a second fix proved raw/copy text, but
the Command Room visible transcript still failed for the WhatsApp conversation.

Cause: the review boundary was file-local instead of product-path-local.
External conversations depend on code outside `modules/channels/*`: commander
conversation runtime, provider session create/resume, queue/send, transcript
projection, shared chat rendering, Markdown rendering, and copy/export all sit
on the same user-visible channel path.

Why review missed it: the "done" evidence did not force the agent to classify
session and transcript changes as channel-impacting. Logs, transcript JSONL,
external provider delivery, and copy text each passed independently, but no gate
required proving visible desktop/mobile Command Room rendering from the same
reply.

Lesson: future agents must run the channel-impacting playbook whenever a change
touches external channels directly or any shared conversation/session/transcript
surface that channel conversations use. If an agent decides the change is not
channel-impacting, that decision and reason must be written in the issue or PR.

Minimum evidence before declaring a channel path fixed:

- provider inbound accepted the message.
- surface binding and `sessionKey` still route to the intended conversation.
- provider session create/resume/send works for the conversation.
- assistant transcript is persisted.
- automatic outbound dispatch sends the exact final text.
- external provider receives that exact text.
- `/api/conversations/:id/messages` projects that same text.
- desktop and mobile Command Room visibly render that text.
- copy/export preserves the raw text.
- `channelReplyDelivery`, `channelMeta`, and `lastRoute` remain coherent.

Primary sources:

- `apps/herd/.dev/playbooks/channel-impacting-change.md`
- `apps/herd/.dev/VERIFY.md`
- `apps/herd/modules/commanders/routes/conversation-runtime.ts`
- `apps/herd/modules/commanders/channel-dispatchers.ts`
- `apps/herd/modules/agents/messages/history.ts`
- `apps/herd/modules/agents/components/session-message-list/blocks.tsx`
