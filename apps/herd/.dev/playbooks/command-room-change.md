# Command Room Change

1. Identify whether the change is presentation-only or changes backend-owned
   state/action behavior.

2. Start with:
   - `apps/herd/modules/command-room/components/CommandRoom.tsx`
   - `apps/herd/modules/conversation/hooks/use-conversations.ts`
   - `apps/herd/modules/commanders/routes/conversation-read-model.ts`
   - `apps/herd/modules/commanders/routes/conversation-runtime.ts`
   - `apps/herd/modules/commanders/routes/conversation-websocket.ts`

3. If composer, queue, or transcript behavior changes, inspect:
   - `apps/herd/modules/agents/components/SessionComposer.tsx`
   - `apps/herd/modules/agents/queue-state.ts`
   - `apps/herd/modules/agents/queue-mutation.ts`
   - `apps/herd/modules/command-room/components/transcript.ts`

4. If mobile behavior changes, inspect:
   - `apps/herd/modules/command-room/components/mobile/MobileCommandRoom.tsx`
   - `apps/herd/modules/agents/components/MobileSessionShell.tsx`
   - `apps/herd/modules/approvals/MobileInbox.tsx`

5. Verify:

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

6. Contrarian check: any new UI state that gates send/start/resume/pause/archive
   must map to backend `allowedActions` or read-model fields.
