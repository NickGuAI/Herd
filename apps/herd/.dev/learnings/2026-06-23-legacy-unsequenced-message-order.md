# 2026-06-23 Legacy Unsequenced Message Order

Incident: after a Codex resume, the assistant completed a heartbeat turn and
`Awaiting input` appeared, but a much older heartbeat user prompt still showed
as the last message when fetching a larger message page.

Cause: older persisted transcript rows can contain legacy `type: "user"` /
`subtype: "queued_message"` events without timestamp or seq. The canonical
timeline sorter put unsequenced rows after every sequenced row, even when the
persisted JSONL file order proved the legacy row belonged earlier in history.
Small pages could look correct while larger pages exposed the stale user prompt
as latest.

Lesson: persisted transcript file order is a backend ordering fact. When two
events come from the same persisted source and either event lacks time or seq,
preserve file order instead of treating the unsequenced row as newer than all
sequenced rows. This is especially important for resume checks where "latest
message" is user-visible.

Primary sources:

- `apps/herd/modules/agents/messages/canonical-timeline.ts`
- `apps/herd/modules/agents/messages/__tests__/canonical-timeline.test.ts`
- `apps/herd/modules/agents/messages/history.ts`
- `apps/herd/modules/commanders/routes/conversation-runtime.ts`
