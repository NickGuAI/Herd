# Learnings

Record dated lessons from fixes and reviews here when they are reusable for
future Herd work. Keep each lesson tied to source files or incidents.

- `2026-06-23-active-conversation-no-live-resume.md`: active conversation,
  live session presence, and SQLite runtime session state are separate backend
  facts; active/no-live resume must be backend-owned.
- `2026-06-23-codex-app-server-initialize.md`: Codex app-server protocol drift
  can break resume before `thread/resume`; compare generated protocol types
  when initialize fails.
- `2026-06-23-legacy-unsequenced-message-order.md`: mixed legacy and sequenced
  transcript rows from the same persisted source must preserve file order.
- `2026-06-24-claude-codex-channel-turn-sequencing.md`: Claude/Codex event
  sequencing differences for channel reply forwarding; `clientSendId` and
  provider `turnId` are separate correlation handles.

Superseded cleanup on 2026-07-06: the duplicate 2026-06-23 channel review
incident notes were removed because their durable guidance now lives in
`apps/herd/.dev/playbooks/channel-impacting-change.md`,
`apps/herd/.dev/maps/channels.md`, and `apps/herd/.dev/VERIFY.md`.
