# Command Room

## Purpose

Command Room is the primary desktop/mobile operating shell. It composes
commanders, conversations, agents, workspace, approvals, automations, quests,
provider selection, and settings.

## Source Files

- `apps/herd/modules/command-room/components/CommandRoom.tsx`
- `apps/herd/modules/command-room/components/mobile/MobileCommandRoom.tsx`
- `apps/herd/modules/command-room/route-metadata.ts`
- `apps/herd/modules/conversation/hooks/use-conversations.ts`
- `apps/herd/modules/commanders/routes/conversation-runtime.ts`
- `apps/herd/modules/commanders/routes/conversation-read-model.ts`
- `apps/herd/modules/commanders/routes/conversation-runtime-state.ts`
- `apps/herd/modules/commanders/routes/conversation-websocket.ts`
- `apps/herd/modules/agents/websocket.ts`
- `apps/herd/modules/agents/components/SessionComposer.tsx`
- `apps/herd/modules/agents/components/session-message-list/render-items.ts`
- `apps/herd/modules/agents/messages/stream-event-machine.ts`
- `apps/herd/modules/agents/queue-state.ts`
- `apps/herd/modules/workspace/use-workspace.ts`
- `apps/herd/src/module-manifest.ts`
- `apps/herd/docs/architecture/command-room.md`
- `apps/herd/docs/architecture/frontend-surfaces.md`

## Owned State/Data

Command Room owns browser preferences such as workspace panel state. Durable
conversation, commander, runtime session, workspace, approval, and automation
data are owned by their modules.

## External Surfaces

- `/command-room`
- `/command-room/inbox`
- `/command-room/settings`
- `/api/conversations/:id`
- `/api/commanders/:id/conversations/bootstrap`
- `/api/conversations/:id/messages`
- `/api/conversations/:id/ws`
- `/api/agents/sessions/:name/ws`
- `/api/conversations/:id/message`
- `/api/agents/sessions/:name/send`

## Coupled Modules

- `commanders`: commander identity, conversations, quest board, heartbeat.
- `conversation`: hooks and embedded UI metadata.
- `agents`: sessions, queue, transcript, websocket.
- `workspace`: file tree, git panel, context insertion.
- `approvals`, `automations`, `settings`, `providers`.

## When Touching This, Also Inspect

- `apps/herd/docs/module-index.xml`
- `apps/herd/docs/concepts/command-room.md`
- `apps/herd/docs/features/commanders.md`
- `apps/herd/modules/command-room/__tests__/backend-owned-contract-guardrails.test.ts`

## Verification Bundle

```bash
pnpm --filter herd exec vitest run \
  modules/command-room/__tests__/chat-pane.test.ts \
  modules/command-room/__tests__/backend-owned-contract-guardrails.test.ts \
  modules/command-room/components/desktop/__tests__/CommandRoom.chat-start.test.tsx \
  modules/command-room/components/mobile/__tests__/MobileCommandRoom.conversations.test.tsx \
  modules/conversation/__tests__/use-conversations-message.test.tsx \
  modules/conversation/__tests__/use-conversations-start-stop.test.tsx \
  modules/agents/__tests__/MobileSessionShell.test.tsx
```

## Known Risks / Open Questions

- Sending/queueing availability must come from backend read models and action
  fields, not raw session-name or websocket guesses.
- Commander selection and cold-open use the one-shot conversation bootstrap
  projection. Keep pushed WebSocket list deltas updating both legacy list caches
  and bootstrap projection caches; otherwise idle tabs stop refreshing.
- Mobile and desktop share data but have divergent surfaces; test both when a
  shared hook changes.
- Conversation-bound chat and standalone session chat use different endpoints;
  check both when changing composer behavior.
- Sub-agent activity groups correlate by durable transcript ids. Header counts
  must distinguish owners from nested tool calls, and provider-runtime
  boundaries must settle prior running rows in the stream state machine rather
  than through viewport or websocket inference.
