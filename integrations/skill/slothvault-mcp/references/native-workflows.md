# Native MCP workflow examples

Use business names through the host's discovered tools and actual schemas. Host-generated prefixes can differ.

## Clone a published source into an empty draft

Read both versions and the target tree, then call `content.project.version.clone`:

```json
{"projectId":"1","sourceVersionId":"2","targetVersionId":"3"}
```

The source must be a published, undeleted version of the same project. The target must be an undeleted draft with no undeleted categories, notes, or bodies. The service checks this in the transaction. A nonempty target is not automatically replaced.

To create a new draft from the source instead:

```json
{"projectId":"1","sourceVersionId":"2","version":"1.0.1","description":"Next draft"}
```

Do not combine `targetVersionId` with new-version metadata.

## Reuse and upload attachments

Inspect `content.file.list` and `content.file.get` before uploading. An upload of UTF-8 bytes `# Guide` uses:

```json
{"originalName":"guide.md","businessType":"Markdown","contentBase64":"IyBHdWlkZQ=="}
```

Read returned `id`, `filePath`, `resourceUri`, MIME type, and size. Use actual paths in Markdown and protected URIs for Resource reads; never guess public attachment URLs. Re-list files after an uncertain upload result before retrying.

Managed-file Resource URIs have the form `slothvault://managed-file/44`; contract attachments use `slothvault://contract-attachment/12`. Each Resource request requires the same Key authentication. Binary saving is a host capability, not a Skill guarantee. Use the authenticated website download if the host cannot save the blob.

## Publication

Run `content.project.version.check_draft` after bodies and links are ready. Fix issues within the task and publish only if requested. Read the resulting version and integrity. An upload or copied connection configuration is not evidence that the project was published.
