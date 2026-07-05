# Commander Bundles [Spec v2]

Commander bundles are portable JSON files for sharing a commander without a
hosted registry. Export creates one file; import recreates a working commander
in another Herd install.

## Publish Flow

```text
╔═══════════════╗      export JSON       ╔═══════════════╗
║ Install A     ║ ─────────────────────▶ ║ bundle file   ║
║ Commander     ║                        ║ *.bundle.json ║
╚═══════╤═══════╝                        ╚═══════╤═══════╝
        │                                        │
        │ persona/config                         │ import file
        │ COMMANDER.md                           ▼
        │ memory                         ╔═══════════════╗
        │ automations                    ║ Install B     ║
        │ skill dirs                     ║ Commander copy║
        ▼                                ╚═══════════════╝
```

Users export from the org commander action menu. Users import from
Marketplace's `Install from file` action. The file can be shared directly,
checked into a repository, or attached to an issue.

## Format

The current bundle schema is `schemaVersion: 2`.

```text
commander-bundle.json
├─ schemaVersion: 2
├─ exportedAt
├─ sourceCommanderId
├─ commander
│  ├─ displayName, host, provider/model defaults
│  ├─ context defaults
│  └─ profile
├─ commanderMd
├─ memorySnapshot
├─ skills[]              package-style skill metadata
├─ skillBindings[]       bundled files or name-reference fallback
└─ automations[]         package-style automation definitions
```

`skills[]` follows the commander package dependency shape:

```json
{
  "id": "engineering-review",
  "label": "Engineering Review",
  "purpose": "Review changes.",
  "required": true
}
```

`skillBindings[]` carries the portable content. Bundled skills include every
file under the skill directory except ignored build/cache directories:

```json
{
  "skillId": "engineering-review",
  "source": "commander-local",
  "bundle": {
    "dirName": "engineering-review",
    "files": [
      {
        "path": "SKILL.md",
        "contentBase64": "..."
      }
    ]
  }
}
```

If a skill is referenced by an automation but the exporter cannot bundle its
directory, the binding records a reference fallback:

```json
{
  "skillId": "external-review",
  "source": "reference",
  "reference": {
    "reason": "not-found"
  }
}
```

Referenced fallback skills must already exist in the target install for
scheduler-backed automation creation to validate them.

`automations[]` follows the bundled commander package automation shape, with
optional source fields preserved from exported runtime definitions:

```json
{
  "id": "daily-round-trip",
  "label": "daily-round-trip",
  "purpose": "Portable scheduled automation",
  "trigger": "schedule",
  "schedule": "0 9 * * *",
  "instruction": "Run the portable round-trip automation.",
  "agentType": "claude",
  "status": "active",
  "timezone": "America/New_York",
  "skills": ["round-trip-skill"],
  "sourceConversationId": "conversation-source"
}
```

## Import Behavior

Import creates a new commander with a unique host/display name, writes
`COMMANDER.md`, restores memory, installs bundled skill directories under the
new commander's `skills/` directory, then creates commander-scoped automations
with `parentCommanderId` set to the new commander id.

The operation rolls back created automations, session state, display name, and
commander files if any step fails.

## Compatibility

`POST /api/commanders/import` accepts both schema v2 bundles and legacy
`schemaVersion: 1` templates. v1 imports restore the old persona/config,
`COMMANDER.md`, memory snapshot, and simple skill reference list, but v1 files
do not contain portable skill directories or automation definitions.
