# Skill changes

## 1.2.3

- Document compact Manifest v3 credentials for published project versions and direct wallet signing to the website flow.
- Freeze published version numbers, category names, and note titles alongside bodies and document structure; retain project-name, description, and weight edits.

## 1.2.2

- Add single-note tag list/add/rename/remove guidance with exact inputs and complete resulting tag lists.
- Prefer atomic one-tag tools for local changes; preserve whole-list replacement only when explicitly requested.
- Document draft-only tag writes, clone preservation, idempotent add/remove, rename conflicts and read-back after uncertain writes.

## 1.2.1

- Separate independent article body images/downloads (`ArticleImage` / `ArticleAttachment`) from project note images/downloads (`NoteImage` / `NoteAttachment`).
- Require all material uploads to succeed before composing or saving bodies; use returned `filePath` values for website links and `resourceUri` only for MCP reads.
- Stop body writes on upload failure, inspect uncertain results before retrying, and reuse successful assets without guessed paths or placeholder links.

## 1.2.0

- Limit supported connections to Codex and Claude Code native MCP; distinguish connection recovery from uncertain-write verification without replaying workflows.
- Route article operations and technical writing to focused references while preserving project, attachment, and recovery capabilities.
- Use MCP 5 metadata-only article lists and on-demand details; document live edits, withdrawal state, and uncertain-write recovery.
- Ship an optional Python 3.10+ standard-library Markdown checker with line-located findings and explicit manual-review limits.
- Keep native MCP connection independent of Python and preserve existing installation and invocation policy.

## 1.1.0

- Use the host's discovered native SlothVault MCP tools and current schemas for administrator workflows.
- Obtain one-time Codex and Claude Code connection configurations from the administrator website; no dedicated Client is required.
- Preserve draft reuse, published-body freezing, attachment reuse, publication checks, and read-back before retrying uncertain writes.
- Document host-dependent binary Resource handling and the authorized website download alternative.

## 1.0.0

- Published the SlothVault MCP Skill as an independent, manually installable package.
- Kept agent installation and update handling in SlothTool.
