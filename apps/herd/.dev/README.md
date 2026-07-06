# Herd .dev Context

This directory is the code-grounded maintenance map for Herd. Use it before
changing runtime sessions, Command Room, installer/release/CLI behavior,
providers, or mobile/desktop UI.

It is not a second source of truth. The source of truth remains the code and
docs cited in each file.

```text
+---------------------------+
| Start with README/ROUTING |
+-------------+-------------+
              |
              v
+---------------------------+
| Read the relevant map     |
| maps/*.md                 |
+-------------+-------------+
              |
              v
+---------------------------+
| Follow the playbook       |
| playbooks/*.md            |
+-------------+-------------+
              |
              v
+---------------------------+
| Prove with VERIFY.md      |
| and record in EVALUATION  |
+---------------------------+
```

## Files

| File | Use |
|---|---|
| `ROUTING.md` | Start here when touching a subsystem. |
| `COUPLINGS.md` | Cross-module dependencies and ownership boundaries. |
| `VERIFY.md` | Verification bundles by change type. |
| `SOP_INDEX.md` | Install, release, CLI, and ops source pointers. |
| `EVALUATION.md` | Evidence used to generate and check this directory. |
| `maps/` | Source-backed subsystem maps. |
| `playbooks/` | Change-specific runbooks. |
| `techdebt/` | Current unresolved debt and shipped mitigations that future work must not forget. |

## High-Risk Boundaries

- Runtime session state is owned by SQLite/backend DTOs, not by UI inference:
  `apps/herd/server/db/schema.ts`,
  `apps/herd/modules/agents/session/sqlite-runtime-store.ts`,
  `apps/herd/modules/agents/session/state.ts`.
- Agents routes wait for persisted session restore before serving
  `/api/agents/*`:
  `apps/herd/modules/agents/routes-core.ts`,
  `apps/herd/modules/agents/persistence-helpers.ts`,
  `apps/herd/modules/agents/session/persistence.ts`. Keep
  `runtime_state_json` small enough to read at restart. Oversized replay events
  in SQLite rows can make the first protected agents request look like UI click
  latency even while `/api/health` stays fast.
- Command Room composes data from agents, commanders, conversations, workspace,
  approvals, automations, and settings:
  `apps/herd/modules/command-room/components/CommandRoom.tsx`,
  `apps/herd/docs/module-index.xml`.
- Channel-impacting changes are cross-surface changes even when the edited file
  is not under `modules/channels/*`. Session create/resume, queue/send,
  conversation read models, transcript projection, shared chat rendering, and
  Markdown behavior can all break WhatsApp/email/etc. A successful external send
  is not enough: inspect inbound adapter/runtime, surface binding, conversation
  metadata, automatic reply dispatch, transcript projection, delivery status,
  and visible Command Room rendering before declaring done. Evidence must trace
  the same external peer, same `conversationId`, and same assistant reply text
  across transcript JSONL, message API, provider delivery, desktop UI, mobile
  UI, copy/export, delivery status, and provider runtime health after relaunch.
  Follow `playbooks/channel-impacting-change.md` and paste its `Channel
  Critical Review Packet` into the issue or PR before merge, relaunch signoff,
  or final handoff.
- Install/release/CLI changes must stay aligned across
  `apps/herd/install.sh`, `operations/deploy/ec2/install-ec2.sh`,
  `operations/scripts/launch_herd.sh`,
  `operations/sops/SOP-15-release-herd.md`, and
  `packages/herd-cli/src/`.
- Production UI styling uses the Herd/Sumi-e token implementation in
  `apps/herd/src/styles/hervald/tokens.css` and
  `apps/herd/src/lib/hv-tokens.ts`. Use `--hv-*` tokens from those files
  for app UI; `docs/design-systems/sumi-e/` is reference material, not the
  runtime stylesheet.

## Update Triggers

Update this directory when any of these change:

- SQLite schema, runtime-session DTOs, migration/readiness scripts, or session
  control/query routes.
- Persisted-session restore, transcript replay fallback, `runtime_state_json`
  payload shape, or agents route startup gates.
- Command Room routing, chat/composer behavior, conversation websocket behavior,
  workspace context, or queue behavior.
- Channel provider adapters, channel bindings, surface binding resolution,
  inbound external messages, automatic outbound replies, channel-visible
  transcripts, or channel management UI.
- Installer, launch, EC2 deploy, public release sync, CLI onboarding/up/doctor,
  worker/session CLI output, or docs commands.
- Provider registry/adapters, provider auth, machine auth, model selection, or
  provider context persistence.
- Mobile/desktop split, shared hooks, or UI tests that encode responsive
  behavior.
- New production incidents that leave mitigations or follow-up work should add
  or update a file under `techdebt/`.
