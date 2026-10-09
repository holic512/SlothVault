# Project and attachment workflows

Identify the project/version and reuse specified drafts, bodies, and attachments. Published names, titles, descriptions, and weights remain editable; send only changed fields.

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

Save final bodies, images, and links, then run `content.project.version.check_draft`. Fix reported issues within authorization and recheck changed content. Do not publish an empty draft. If publication was requested, call `content.project.version.publish`, then verify state/visibility and `content.project.version.integrity`. A draft-only request ends at the saved draft. Metadata renames alone do not require another version.
