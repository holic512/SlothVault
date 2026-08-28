---
name: project-knowledge-base
description: Analyze a real local project and produce a SlothVault-compatible project knowledge-base ZIP or single technical-article ZIP. Use for source-grounded Chinese project documentation, knowledge-planet articles, and importable technical article packages; do not use for generic prose without source evidence.
---

# Project Knowledge Base Package

Create source-grounded, Chinese technical documentation that SlothVault can import and continue to edit. The output is a ZIP package, not a loose Markdown response.

## Inputs and modes

- **Project package:** Receive a local project directory and produce a coherent, multi-category knowledge base. It is imported by selecting an existing SlothVault project and entering a new project-version label.
- **Article package:** Receive a local project directory plus one narrowly defined article topic. Produce exactly one category and one article. It is imported into an existing SlothVault draft version.

Read [the package contract](references/package-format.md) before creating the structured source file. Use `scripts/build-package.mjs` to produce the final ZIP and `scripts/validate-package.mjs` to verify it. Both scripts apply the same strict Skill-side contract, so an invalid package is rejected before it is handed to SlothVault.

## Evidence-first workflow

1. Inspect the repository before outlining: entry points, manifests and lockfiles, source modules, configuration templates, SQL/migrations, tests, README, and deployment files relevant to the requested topic.
2. Build a compact evidence ledger of actual paths and symbols. Treat implementation as the authority when comments or README text conflict with executable code.
3. Plan categories and articles from observed capabilities. Do not force database, cache, authentication, messaging, deployment, or architecture sections that the project does not have.
4. Write `knowledge-base.json` with the required structured article fields. Every article must carry `sourceReferences` that point to real paths; include symbols only when they were verified.
5. Write natural Chinese Markdown for each article in its `content` field. Explain the problem and design intent before implementation details. Use real code snippets only when they clarify the flow. State `无法从当前源码确认` rather than guessing.
6. Package and validate:

   ```bash
   node skills/project-knowledge-base/scripts/build-package.mjs \
     --input /absolute/path/knowledge-base.json \
     --source-root /absolute/path/inspected-project \
     --kind project \
     --output /absolute/path/project-knowledge.zip

   node skills/project-knowledge-base/scripts/validate-package.mjs \
     /absolute/path/project-knowledge.zip \
     --source-root /absolute/path/inspected-project
   ```

   For a single article, use `--kind article` and ensure the source JSON contains exactly one category with one article.

## Writing requirements

- The writing is for developers learning how the project is designed, not a generated API catalog or README rewrite.
- Use clear information hierarchy: project positioning, capabilities, architecture/design choices, module or workflow details, and practical reading paths where evidence supports them.
- Avoid stock AI transitions and ungrounded superlatives. Preserve uncertainty explicitly.
- Keep `id` and `slug` stable, lowercase ASCII identifiers. Use article order and category order to express the intended reading sequence.
- The final archive contains the full structured JSON plus a Markdown mirror for every article. Do not hand-edit the archive after the package script has generated it.

## Mandatory hard validation

The builder is intentionally a gate, not a best-effort formatter. It will not create or replace the requested ZIP unless every rule below passes, and the validator checks the same rules again.

- The JSON structure is closed: required objects and article fields must all be present; unknown fields, duplicated IDs/slugs/order values, duplicate tags, empty categories, and whitespace-only article bodies are rejected.
- Text limits mirror the importer: article body ≤ 500,000 JavaScript characters and ≤ 2,000,000 UTF-8 bytes; title ≤ 255; category title ≤ 64; article/category ID ≤ 128; slug ≤ 160; article summary/project description/knowledge-base summary ≤ 2,000; tag ≤ 64 with at most 30 tags; each article has 1–500 source references.
- A package contains 1–100 categories and no more than 500 articles. An `article` package contains exactly one category and one article.
- `--source-root` is required. Every `sourceReferences[].path` must be a relative POSIX path that resolves to a readable regular file beneath that inspected project directory. Paths with `..`, absolute paths, backslashes, or symlink resolution outside the root fail.
- The archive must contain only `manifest.json`, `knowledge-base.json`, and the required `articles/<slug>.md` mirrors. Hashes, byte counts, UTF-8 encoding, and exact Markdown mirrors are checked.
- Current SlothVault ZIP ceilings apply before import: compressed ZIP ≤ 250 MB, at most 10,000 entries, each entry ≤ 256 MB, and aggregate uncompressed data ≤ 1 GB. `knowledge-base.json` is limited to 32 MB.

## Boundaries

- Never include secrets, private `.env` values, credentials, cookies, or local user data in article content or source references.
- Do not claim that SlothVault itself ran an AI model: this Skill is the AI-assisted generation step, while SlothVault only validates and imports its package.
- Do not attempt incremental comparison in this Skill unless the user separately requests it; the current package contract is intentionally a simple full-project or one-article import format.
