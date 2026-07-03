# 2026-06-23 Channel V2 Forwarder Miss

Incident: WhatsApp channel conversations received assistant output in the
conversation transcript, but no reply was sent back to WhatsApp.

Cause: the automatic channel reply forwarder in
`modules/commanders/routes/conversation-runtime.ts` recognized legacy stream
events by raw names: `message_start` began the assistant turn and `result`
completed it. Production channel conversations were emitting schema-v2
transcript envelopes with `ev.type = "message.start"` and
`ev.type = "turn.end"`. The forwarder never saw a completed assistant turn, so
it never extracted text and never called `dispatchCommanderChannelReply`.

Why review missed it: the review checked provider delivery and legacy route
tests, but did not trace the full channel product path from transcript event
schema through automatic reply extraction and outbound dispatch.

Lesson: any channel-impacting change that touches transcripts, event
normalization, message projection, provider runtime, or session resume must
search for raw event-name assumptions and prove the schema-v2 envelope path.
The minimum regression is a conversation-runtime test that emits transcript
envelopes, waits for `dispatchCommanderChannelReply`, and asserts the exact
assistant text.

Primary sources:

- `apps/herd/modules/commanders/routes/conversation-runtime.ts`
- `apps/herd/modules/commanders/routes/__tests__/conversation-runtime.test.ts`
- `apps/herd/modules/agents/messages/history.ts`
- `apps/herd/src/types/transcript-envelope.ts`
