# 2026-06-23 Channel Visible Transcript Review

Incident: WhatsApp received the assistant reply and the Command Room copy button
copied the correct raw text, but the visible Command Room bubble appeared blank.

Cause: the assistant reply was `2026.`. Shared chat rendering sends assistant
text through `ReactMarkdown`; a whole-message string of `2026.` is parsed as an
ordered-list marker with an empty item. Raw text paths bypassed that renderer,
so transport and copy checks passed while visible UI failed.

Lesson: channel-impacting fixes must verify every user-visible surface, not just
raw transport. For channel replies, require:

- raw transcript event exists.
- `/api/conversations/:id/messages` projects the expected assistant text.
- external provider receives the expected assistant text.
- Command Room visibly renders the expected assistant text.
- copy/export preserves raw text.
- regression tests include markdown-like plain-text replies such as `2026.`,
  `1.`, and `1)`.

Primary sources:

- `apps/herd/modules/commanders/routes/conversation-runtime.ts`
- `apps/herd/modules/commanders/routes/context.ts`
- `apps/herd/modules/channels/whatsapp/adapter.ts`
- `apps/herd/modules/agents/messages/history.ts`
- `apps/herd/modules/agents/components/session-message-list/blocks.tsx`
