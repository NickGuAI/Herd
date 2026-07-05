# Contributing To Herd

Herd accepts scoped community pull requests under the project license model:
PolyForm Noncommercial for noncommercial use, with separate commercial
licensing available from the maintainers.

For discussion, support, and community questions, use the Pioneering Minds AI
community at https://pioneeringminds.ai. GitHub Discussions are intentionally
disabled for this repository.

## Pull Request Flow

```text
issue or scoped change
        |
        v
open pull request
        |
        v
check CLA acknowledgement
        |
        v
maintainer review
        |
        v
maintainer merge
```

Maintainers merge accepted pull requests. Community contributors should not
expect direct pushes to `main`.

## Before Opening A Pull Request

1. Search existing issues and pull requests for related work.
2. Keep the change focused on one bug, feature, or documentation update.
3. Add or update tests when behavior changes.
4. Update documentation when setup, operation, CLI behavior, or security posture
   changes.
5. Read and agree to the [Contributor License Agreement](./CLA.md).

## CLA Requirement

Every pull request must include the checked CLA acknowledgement from the pull
request template:

```text
- [x] I have read and agree to the Herd Contributor License Agreement in CLA.md.
```

The `CLA acknowledgement` workflow fails until that box is checked. Maintainers
review and merge only after the CLA check and the relevant test checks pass.

## Issue Use

Use GitHub issues for reproducible bugs and scoped feature requests.

Use https://pioneeringminds.ai for:

- setup questions,
- operator discussion,
- roadmap discussion,
- support that is not a reproducible repository bug.
