# Commander Packages [Spec v1]

Commander packages are the product unit for bundled Herd employees. A package
defines the commander identity, required skills, onboarding guide, examples, and
safe memory seed. The backend owns package loading and installation; frontend
surfaces only render package state and call install APIs.

Portable commander bundles are a separate publish format for user-exported
commanders. Bundles include runtime memory, commander-scoped automations, and
embedded skill directories. See [Commander Bundles](commander-bundles.md).

## Package Layout

Bundled packages live under
`apps/herd/modules/commanders/packages/bundled/<package-id>/`.

```text
commander-package/
├─ package.json
├─ COMMANDER.md
├─ skills.manifest.json
├─ memory-seed.md
├─ onboarding.md
├─ examples/
└─ assets/
```

`package.json` contains package metadata: schema version, id, version,
displayName, host, role, summary, description, provider defaults, effort,
context mode, and UI profile defaults.

`COMMANDER.md` is product-safe identity and operating style. It must not contain
private operator memory, private file paths, private issue history, or
organization-specific claims.

`skills.manifest.json` names required and optional skill dependencies. Skills are
dependencies; the commander package is the user-facing unit.

`memory-seed.md`, `onboarding.md`, and `examples/` provide safe first-run
context and examples that the user can inspect before install.

## Bundled Workforce

The default Herd workforce contains:

- `engineering-manager`: Asina, an engineering manager for issue triage, code
  investigation, review, orchestration, and release follow-through.
- `research-intelligence-analyst`: Einstein, a research analyst for web
  research, knowledge search, domain distillation, and reports.
- `general-assistant`: Alfred, a general assistant for meeting prep, scheduling,
  daily support, inbox/doc triage, and follow-through.

## API

- `GET /api/commanders/packages` lists bundled packages with install state.
- `GET /api/commanders/packages/:packageId` returns one package.
- `POST /api/commanders/packages/:packageId/install` installs the package
  idempotently. Existing non-archived commanders with the same `templateId` are
  returned instead of duplicated.
- `POST /api/onboarding/actions/seed-starter-workforce` installs the bundled
  starter workforce during first-run onboarding.

## Install Behavior

Installation creates a normal commander session, default conversation, display
name, profile, `COMMANDER.md` identity section, and an inspectable `.package/`
snapshot under the installed commander's data directory.

The backend resolves duplicate hosts and display names before creation. The UI
does not assemble identity, skills, memory, or package rules.
