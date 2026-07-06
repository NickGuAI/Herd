# Changelog

All notable Herd release changes are recorded here for operators upgrading an
installed checkout. `RELEASE_NOTES.md`, when present in the release process,
continues to be the GitHub release body; this file ships in the public artifact.

## Unreleased

- Nothing yet.

## v0.0.6-beta — 2026-07-06

- Added first-run runtime defaults for global rules and shared commander
  knowledge so fresh Herd installs start with workspace routing, doctrine,
  skill routing, and shared learnings files.
- Added default operator housekeeping automations for memory consolidation and
  context hygiene after founder setup, with required public skills bundled in
  the release artifact.
- Improved command-room and mobile settings smoothness with updated mobile
  navigation, workspace preview handling, transcription reliability, credential
  readiness, and provider-auth surfaces from the latest integration batch.
- Finished the enterprise EC2 release lane: `herd.service`, `HERD_*` runtime
  environment, private `PORT=20009`, Caddy shell on `:20001`, split-shell smoke
  tests, and public release guardrails.
- Tightened public artifact checks so Herd release sync fails if runtime
  defaults, housekeeping skills, EC2 deploy assets, public docs, or installer
  pins drift.

## v0.0.5-beta — 2026-07-05

- Added `herd update` for in-place release upgrades. It fetches a release tag,
  rebuilds the checkout, runs JSON-store and SQLite readiness checks, and
  restarts the installed service when the platform service manager is available.
- Added `schemaVersion` to the JSON data stores under the Herd data directory:
  commanders, API keys, policies, automations, operators, settings, and
  machines. Boot now migrates legacy stores or refuses unsupported versions with
  an explicit readiness error.
- Changed `herd onboard` defaults to use the local installed instance instead
  of a hosted endpoint. It derives the port from the installed app `.env` and
  falls back to `http://127.0.0.1:20001`.
- Added Linux user-systemd autostart for fresh local installs, alongside the
  existing macOS launchd service.
- Expanded uninstall and enterprise upgrade documentation with service, data
  directory, toolchain, and rollback steps.
