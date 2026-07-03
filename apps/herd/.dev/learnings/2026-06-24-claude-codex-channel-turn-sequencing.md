# 2026-06-24 Claude/Codex Channel Turn Sequencing

Incident: channel reply review exposed a bad assumption in the automatic reply
forwarder: a channel user's `clientSendId` and the provider's `turnId` are not
guaranteed to appear on the same user `message.start` event. They are different
correlation handles with provider-specific timing.

Read this first:

- `clientSendId` is Herd's external-send correlation id. It is created when
  a channel message enters Herd and is present on the synthetic visible user
  transcript envelope for both Claude and Codex.
- `turnId` is a provider/protocol turn id. The automatic channel reply forwarder
  must treat it as optional at user-envelope time.
- Claude path: arm from `clientSendId`; there may never be a reliable matching
  provider `turnId` on the user envelope, so collect the next top-level visible
  assistant completion by stream order.
- Codex path: arm from `clientSendId`; bind to a provider `turnId` later when
  `turn/started`, `turn/completed`, or an active `turn/steer` path exposes it.
- Bug shape: if the forwarder waits for `turnId` before arming, real channel
  sends look unrelated to the later assistant turn. If bootstrap skip accounting
  then consumes the active send, WhatsApp/other channel replies are dropped.

Code anchors:

- Claude synthetic visible user envelopes are built in
  `apps/herd/modules/agents/event-normalizers/claude.ts`
  `createClaudeUserTranscriptEnvelopes`. They include `clientSendId` and
  `itemId`, not `turnId`.
- Codex synthetic visible user envelopes are built in
  `apps/herd/modules/agents/adapters/codex/session.ts`
  `buildCodexUserEnvelopeEvents`. They include `clientSendId` and `itemId`, not
  `turnId`.
- Codex provider events are normalized in
  `apps/herd/modules/agents/event-normalizers/codex.ts`; `turn/started`
  and `turn/completed` carry the protocol `turnId`.
- Codex send dispatch in `apps/herd/modules/agents/adapters/codex/session.ts`
  can use `turn/steer` when `session.activeTurnId` exists. A channel message can
  therefore be attached to an already-active Codex turn instead of creating a
  clean new turn.
- Startup and heartbeat sends use hidden user subtypes from
  `apps/herd/modules/agents/user-event-subtypes.ts`:
  `commander_startup` and `heartbeat`.

## Claude Sequence

```text
╔════════════════════════════════════════════════════════════════╗
║ Channel send has clientSendId=C                              ║
╚═══════════════════════════════╤════════════════════════════════╝
                                │
                                v
╔════════════════════════════════════════════════════════════════╗
║ Herd synthetic user transcript                           ║
║ message.start / message.delta / message.end                   ║
║ correlation: clientSendId=C, itemId=C                         ║
║ provider turnId: absent                                       ║
╚═══════════════════════════════╤════════════════════════════════╝
                                │
                                v
╔════════════════════════════════════════════════════════════════╗
║ Claude CLI assistant stream                                   ║
║ assistant message envelopes and result -> turn.end            ║
║ durable provider turnId matching the user envelope: not       ║
║ guaranteed                                                    ║
╚════════════════════════════════════════════════════════════════╝
```

Rule: for Claude, the forwarder cannot require the visible user envelope to have
a `turnId`. It must arm from `clientSendId` and then collect the next matching
top-level assistant completion by stream order and visibility rules.

## Codex Sequence

```text
╔════════════════════════════════════════════════════════════════╗
║ Channel send has clientSendId=C                              ║
╚═══════════════════════════════╤════════════════════════════════╝
                                │
                                v
╔════════════════════════════════════════════════════════════════╗
║ Herd synthetic user transcript                           ║
║ message.start / message.delta / message.end                   ║
║ correlation: clientSendId=C, itemId=C                         ║
║ provider turnId: absent                                       ║
╚═══════════════════════════════╤════════════════════════════════╝
                                │
                                v
          ┌─────────────────────┴─────────────────────┐
          v                                           v
╔══════════════════════════════════╗     ╔══════════════════════════════════╗
║ No active Codex turn             ║     ║ Existing active Codex turn       ║
║ send method: turn/start          ║     ║ send method: turn/steer          ║
║ provider emits turn/started T    ║     ║ expectedTurnId = current T       ║
╚════════════════╤═════════════════╝     ╚════════════════╤═════════════════╝
                 │                                        │
                 └─────────────────────┬──────────────────┘
                                       v
╔════════════════════════════════════════════════════════════════╗
║ Codex assistant events                                        ║
║ turn.start / assistant message / turn.end                     ║
║ correlation: provider turnId=T appears after the user envelope║
╚════════════════════════════════════════════════════════════════╝
```

Rule: for Codex, the forwarder should arm on `clientSendId`, bind to a provider
`turnId` when one appears, and tolerate `turn/steer` into an already-active turn.
It must not spend bootstrap skip counters on the user-armed channel turn.

## Forwarder Requirements

```text
Pending client send ids
        |
        v
user envelope with clientSendId=C? ---- no --> ignore
        |
       yes
        |
        v
arm channel reply for C
        |
        v
provider turnId available? ----------- yes --> bind to T
        |                                      and collect T
       no
        |
        v
collect next top-level assistant turn by stream order
        |
        v
successful top-level turn.end?
        |
        v
dispatch exact final assistant text once
```

Bootstrap and heartbeat nuance:

- Hidden startup/heartbeat turns can complete near a real external-channel send.
- A `skipCompletedTurns` counter may be used to skip unarmed startup completions.
- Once a channel `clientSendId` arms the forwarder, that real turn is not a
  bootstrap turn. Do not decrement skip counters against it.
- Do not classify real user messages by prompt text such as `[HEARTBEAT]`.
  Trust typed `userEventSubtype` only.

## Required Regressions

Any future channel reply change that touches provider event sequencing must prove
these cases:

- Claude-style synthetic user envelope with `clientSendId` and no `turnId`
  still dispatches exactly one provider reply.
- Codex-style synthetic user envelope with `clientSendId`, followed later by
  provider `turn.start`/`turn.end` with `turnId`, dispatches exactly one reply.
- Codex `turn/steer` into an existing `activeTurnId` does not lose the channel
  reply and does not spend a bootstrap skip on the armed turn.
- Startup and heartbeat hidden turns do not dispatch channel replies.
- Failed turns and subagent turns do not dispatch channel replies.
- The same assistant reply text is traced through transcript JSONL,
  `/api/conversations/:id/messages`, external provider delivery, desktop UI,
  mobile UI, copy/export, and delivery status.
