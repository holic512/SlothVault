# MCP Registry (generated)

<!-- GENERATED FILE: run `npm run mcp:docs` after changing MCP declarations. -->

Tool count: **55**

| Tool | Domain | Risk | Idempotency | Resource permission |
| --- | --- | --- | --- | --- |
| `admin.dashboard.get` | `admin.dashboard` | read | idempotent | - |
| `admin.user.list` | `admin.user` | read | idempotent | - |
| `admin.user.get` | `admin.user` | read | idempotent | - |
| `admin.membership.level.list` | `admin.membership.level` | read | idempotent | - |
| `admin.user.membership.get` | `admin.user.membership` | read | idempotent | - |
| `admin.points.transaction.list` | `admin.points.transaction` | read | idempotent | - |
| `admin.gift_card.batch.list` | `admin.gift_card.batch` | read | idempotent | - |
| `admin.contract.list` | `admin.contract` | read | idempotent | - |
| `admin.contract.get` | `admin.contract` | read | idempotent | - |
| `admin.contract.attachment.get` | `admin.contract.attachment` | read | idempotent | contract-attachment:read |
| `admin.evidence.list` | `admin.evidence` | read | idempotent | - |
| `admin.evidence.get` | `admin.evidence` | read | idempotent | - |
| `admin.settings.get` | `admin.settings` | read | idempotent | - |
| `admin.system.update.get` | `admin.system.update` | read | idempotent | - |
| `content.article.list` | `content.article` | read | idempotent | - |
| `content.article.get` | `content.article` | read | idempotent | - |
| `content.article.create` | `content.article` | write | non-idempotent | - |
| `content.article.update` | `content.article` | write | non-idempotent | - |
| `content.category.list` | `content.category` | read | idempotent | - |
| `content.category.create` | `content.category` | write | non-idempotent | - |
| `content.category.update` | `content.category` | write | non-idempotent | - |
| `content.file.list` | `content.file` | read | idempotent | - |
| `content.file.get` | `content.file` | read | idempotent | managed-file:read |
| `content.file.upload` | `content.file` | write | non-idempotent | - |
| `content.note.content.list_versions` | `content.note.content` | read | idempotent | - |
| `content.note.content.get` | `content.note.content` | read | idempotent | - |
| `content.note.content.create_draft` | `content.note.content` | write | non-idempotent | - |
| `content.note.content.update_draft` | `content.note.content` | write | non-idempotent | - |
| `content.note.content.set_primary` | `content.note.content` | write | non-idempotent | - |
| `content.note.list` | `content.note` | read | idempotent | - |
| `content.note.get` | `content.note` | read | idempotent | - |
| `content.note.create` | `content.note` | write | non-idempotent | - |
| `content.note.update` | `content.note` | write | non-idempotent | - |
| `content.project.home.list` | `content.project.home` | read | idempotent | - |
| `content.project.home.get` | `content.project.home` | read | idempotent | - |
| `content.project.home.create` | `content.project.home` | write | non-idempotent | - |
| `content.project.home.update` | `content.project.home` | write | non-idempotent | - |
| `content.project.menu.list` | `content.project.menu` | read | idempotent | - |
| `content.project.menu.get` | `content.project.menu` | read | idempotent | - |
| `content.project.menu.create` | `content.project.menu` | write | non-idempotent | - |
| `content.project.menu.update` | `content.project.menu` | write | non-idempotent | - |
| `content.homepage.get` | `content.homepage` | read | idempotent | - |
| `content.homepage.create` | `content.homepage` | write | non-idempotent | - |
| `content.homepage.update` | `content.homepage` | write | non-idempotent | - |
| `content.project.version.list` | `content.project.version` | read | idempotent | - |
| `content.project.version.get` | `content.project.version` | read | idempotent | - |
| `content.project.version.create_draft` | `content.project.version` | write | non-idempotent | - |
| `content.project.version.clone` | `content.project.version` | write | non-idempotent | - |
| `content.project.version.check_draft` | `content.project.version` | read | idempotent | - |
| `content.project.version.integrity` | `content.project.version` | read | idempotent | - |
| `content.project.version.manifest` | `content.project.version` | read | idempotent | - |
| `content.project.list` | `content.project` | read | idempotent | - |
| `content.project.get` | `content.project` | read | idempotent | - |
| `content.project.create` | `content.project` | write | non-idempotent | - |
| `content.project.update` | `content.project` | write | non-idempotent | - |

Resource count: **2**

| Resource | URI | MIME | Filename limit | Maximum bytes |
| --- | --- | --- | ---: | ---: |
| `managed-file` | `slothvault://managed-file/{id}` | `application/octet-stream` | 255 | 10485760 |
| `contract-attachment` | `slothvault://contract-attachment/{contractId}` | `application/pdf` | 255 | 26214400 |

This document is generated from the declaration registry. CI must run `npm run mcp:docs:check` and fail when the checked-in output is stale.
