# Changelog

All notable Herd release changes are recorded here for operators upgrading an
installed checkout. `RELEASE_NOTES.md`, when present in the release process,
continues to be the GitHub release body; this file ships in the public artifact.

## Unreleased

- Nothing yet.

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
