---
name: create-quests
description: Break a large goal into ordered, non-overlapping implementation quests with dependencies and verification checks.
user-invocable: true
argument-hint: "<goal, issue URL, or project description>"
---

# Create Quests

Use this skill when a request is too large for one uninterrupted implementation pass.

Output:

- Ordered quest list.
- Owner or module scope for each quest.
- Dependencies between quests.
- Concrete verification for each quest.

Keep quests execution-ready and avoid overlapping write ownership.
