# Independent article workflow

## Locate the target

An explicit `articleId` goes directly to `content.article.get`. Otherwise use `content.article.list` with a focused title keyword and paginate candidates as needed. MCP 5 lists return metadata only; never infer a body from `summary`. Read candidate details only to inspect content, edit it, or resolve ambiguity. Reuse discovery and a current detail result within the task.

Before creating, search for existing articles. Keywords match titles and summaries; compare the full title and task context. A title can exceed the keyword limit: use a distinctive substring accepted by the discovered schema, then compare the complete title locally. An exact title match is a candidate, not permission to overwrite it. Multiple plausible candidates need clarification; do not guess a merge or create a second article to escape ambiguity. Search pagination is not a snapshot and does not provide a uniqueness guarantee.

`isDeleted=true` stops ordinary edits; this Skill cannot restore articles. `status=1` means published. `status=0` with `publishedAt` set can be a withdrawn article, because first publication time is preserved. Independent published articles remain editable in place, and edits can immediately affect readers. Do not clone project versions, withdraw, or republish merely to edit an article.

## Prepare, check, and save

For original writing or substantial technical rewrites, read [technical writing](technical-writing.md). Work on a local draft when the host permits; preserve the original before substantial edits. Reuse existing attachments using [the attachment workflow](native-workflows.md#attachments). Only fetch a protected URI when needed; do not upload duplicates for cosmetic reasons.

Before saving a substantial body change, run the optional checker from the installed Skill directory, without loading its implementation into context:

```bash
python3 <skill-directory>/scripts/check_article.py article.md --title 'Article title' --format json
```

It requires Python 3.10+ standard library only. `-` reads UTF-8 stdin. Exit 0 means no deterministic errors (warnings can remain), 1 means content errors, 2 means usage/read failure. It never executes code, accesses the network, or rewrites the article. If Python or local execution is unavailable, use the textbook checklist and report the automated check as not run; do not install a runtime merely for this task.

Resolve relevant findings, not intentional examples. An unfinished draft may still be saved when requested; warnings are not a publication gate. Static checks cannot verify technical truth or completeness of reasoning. Rerun only after relevant body changes. Metadata-only edits do not need the textbook or checker.

Use `content.article.create` once with prepared fields, or `content.article.update` with `articleId` and only changed fields. Use `null` only for intentional clearing of nullable fields; omission preserves them. Skip a no-op update. Keep membership changes in the web administrator interface. A successful mutation returns the full article: reuse it to verify saved fields and state instead of an automatic second `get`.

If the working draft has become stale through a long interruption or signs of another editor, read the current article before overwriting it and reconcile changes. Articles have no revision/CAS parameter or create idempotency key. Read-before-write reduces mistakes but does not lock out concurrent editors; do not claim otherwise.

## Publish or withdraw

Only act on explicit task authorization. Before requested publication, resolve known material content problems and check the intended membership settings; do not infer that a static pass proves technical accuracy. There is no article `check_draft` Tool. `content.article.publish` performs the existing server validation; never send the article to project-version preflight or integrity tools.

If already published and no changes are requested, use the current detail result. Otherwise publish after saving, and verify the returned `id`, `status`, and `publishedAt`. Withdraw with `content.article.withdraw` when requested; verify `status=0`, not a cleared publication timestamp. A withdrawn article can be republished without resetting its first publication date.

## Resume after uncertain results

Keep task-local IDs, intended fields, last confirmed state, and the next step. Never record Keys. After a failure, diagnose before writing again; do not restart the entire workflow or delete partially completed work.

| Uncertain operation | Read-only recovery | Continue only when |
| --- | --- | --- |
| Create, no returned ID | Search the title, then read plausible candidates and compare intended content and metadata | A unique matching result establishes the saved article; otherwise report uncertainty and stop creating |
| Update with known ID | Read that article and compare requested fields | Intended fields are present, or a missing change can be reapplied without overwriting competing changes |
| Publish/withdraw | Read the known article and inspect current state | Desired state is established; if not, resolve the failure before retrying within authorization |
| Upload | Search the file inventory and inspect available metadata | The matching upload is identified; filenames and sizes alone cannot prove identical bytes |

Finish with the article ID or a verified link, actual saved/published state, performed checks, and remaining uncertainty. Never claim exact-once creation, protection from concurrent overwrite, or technical correctness from this workflow alone.
