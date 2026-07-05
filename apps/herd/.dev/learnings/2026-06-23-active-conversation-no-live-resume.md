# 2026-06-23 Active Conversation Without Live Session Resume

Incident: after production relaunch, a Codex conversation showed
`conversation.status = "active"` while its `agent_runtime_sessions` row had
been paused by boot reset. The read model reported `runtimeState = "idle"` and
no live session, but `POST /api/conversations/:id/start` still rejected the
request as "not idle." Command Room could therefore show a reconnect/start
surface that had no working resume path.

Cause: boot reset paused backend runtime sessions but did not mutate commander
conversation records. The read model had partial recovery semantics for
active/no-live conversations, and message delivery could recover that state, but
the explicit UI start/resume action still used the stricter idle-only start
route.

Lesson: `conversation.status`, live session presence, and SQLite runtime session
state are separate backend facts. If a conversation is active but has no live
session, the backend must expose it as a recoverable resume state and the route
used by the UI's "Resume chat" action must recreate the provider session and
fire the immediate heartbeat. Do not fix this by frontend inference.

Primary sources:

- `apps/herd/modules/commanders/routes/conversation-read-model.ts`
- `apps/herd/modules/commanders/routes/register-conversations.ts`
- `apps/herd/modules/commanders/routes/conversation-runtime.ts`
- `apps/herd/modules/commanders/__tests__/conversation-routes.test.ts`
- `apps/herd/server/launch-state-reset.ts`
