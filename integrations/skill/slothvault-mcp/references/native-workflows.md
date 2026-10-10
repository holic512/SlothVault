# Project and attachment workflows

Identify the project/version and reuse specified drafts, bodies, and attachments. Published project names, descriptions, and weights remain editable; send only changed fields. Version numbers, category names, note titles, bodies and document membership are frozen. Version evidence uses one compact Manifest v3 per publication and network; use the website wallet flow for signing.

## Single-note tags

Tags belong to the note, shared by its body revisions. Use the narrow tools for one-tag changes instead of reading a list and overwriting the entire array through `content.note.update`. If a `noteId` is already confirmed, call the needed tool directly; otherwise locate the note within the requested project/version/category first. These tools never edit body content.

| Tool | Input | Behavior |
| --- | --- | --- |
| `content.note.tag.list` | `{ "noteId": "31" }` | Read all tags; published notes are readable. |
| `content.note.tag.add` | `{ "noteId": "31", "tag": "API" }` | Add one tag, retaining others; adding an existing tag is a no-op. |
| `content.note.tag.rename` | `{ "noteId": "31", "tag": "API", "newTag": "接口" }` | Rename in place; a missing source is 404, an occupied new name is 409. |
| `content.note.tag.remove` | `{ "noteId": "31", "tag": "API" }` | Remove only that tag; removing an absent tag is a no-op. |

All return `{ "noteId": "31", "tags": ["接口"] }` with the complete resulting list. Reuse a successful result when it confirms the task; no extra read is required. Tag names are trimmed, nonempty, case-sensitive, at most 30 characters each, with at most 10 per note. A rename to the same existing name is a no-op; do not silently merge tags on a name collision.

Tag writes require an unpublished project version, even when the requested change would be a no-op. `VERSION_FROZEN` means use an existing suitable draft or follow the authorized clone workflow; do not publish or clone automatically for a tag-only request. Clones preserve tags. Tags do not participate in body or project-release hashes.

Keep `content.note.create` / `content.note.update` with `tags` for initial tags or an explicitly requested whole-list replacement. Omitted update `tags` preserves the list, while `[]` clears it. After an uncertain tag-write outcome, use `content.note.tag.list` to inspect the affected note before retrying; for a rename check both old and new names rather than blindly replaying it.

## Draft bodies and clone

For frozen-body or structure changes, read source and target versions and inspect the target tree. To clone into an existing draft:

```json
{"projectId":"1","sourceVersionId":"2","targetVersionId":"3"}
```

The source must be published, undeleted, and in the same project. The target must be an undeleted draft with no undeleted categories, notes, or bodies. Transactional checks preserve the target ID, name, description, and weight. Never replace a nonempty target automatically.

To create a new draft instead:

```json
{"projectId":"1","sourceVersionId":"2","version":"1.0.1","description":"Next draft"}
```

Do not combine `targetVersionId` with new-version metadata. Reuse existing entities; do not create empty placeholder bodies before the real content. The first undeleted body becomes primary automatically. Use `content.note.content.list_versions` for lightweight history and `get` only for bodies needed by the task; change primary selection explicitly when required.

## Attachments

Reuse known suitable uploads. If discovery is needed, search `content.file.list` by filename/business type; use `get` only when its detail or `resourceUri` is needed. Names and sizes alone do not prove identical bytes. UTF-8 bytes `# Guide` can be uploaded as:

```json
{"originalName":"guide.md","businessType":"Markdown","contentBase64":"IyBHdWlkZQ=="}
```

Read actual `id`, `filePath`, `fileSize`, and `resourceUri`. Upload/get metadata does not promise a MIME field; Resource content supplies MIME. Use an ArticleCover upload for an article cover, not an arbitrary attachment path. Upload constraints and Base64 preparation depend on the current schema and host.

Use returned protected URIs, such as `slothvault://managed-file/44` or `slothvault://contract-attachment/12`, with the authenticated host. Do not fetch them as anonymous web URLs. Save Resource `blob` with its `_meta["slothvault/file-name"]` when the host supports it; otherwise use the website's authorized download. Preserve existing destination files.

After an uncertain upload, inspect the inventory and available metadata before retrying; if identity remains ambiguous, stop that write chain. Do not blindly create another file.

## Project publication

Save final bodies, images, and links, then run `content.project.version.check_draft`. Fix reported issues within authorization and recheck changed content. Do not publish an empty draft. If publication was requested, call `content.project.version.publish`, then verify state/visibility and `content.project.version.integrity`. A draft-only request ends at the saved draft. Project-name, description, and weight edits do not require another version; version-number, category-name, and note-title edits require a draft.
