# SlothVault external runtime

This directory owns the administrator MCP client, `slothvault-mcp` command, Codex/Claude Code Skill, and Python deployment program. SlothTool owns the installation, unified update command, and user interface. The application server route and MCP registry stay under `src/server/mcp/` because they use Vault application services.

## Release contract

- Package: `@holic512/slothvault-runtime`, with its own version in `package.json`.
- Release tag: `toolkit-vX.Y.Z` in the SlothVault repository.
- Assets: the `npm pack` archive and `slothvault-toolkit.json` manifest.
- Manifest: package name, version, archive name, SHA-256, Skill version, and `adapterApiMajor`.
- Archive: locked production dependencies through `npm-shrinkwrap.json`, `runtime-contract.json`, and `skill-release.json` with per-file digests.

SlothTool verifies the manifest and archive, installs locked dependencies in a staging directory, verifies the package and Skill, then switches its `current` runtime pointer. The JSON command interface in `bin/slothvault-runtime.js` is compatible within one `adapterApiMajor`. Changing that major requires a matching SlothTool adapter release. Keep existing command flags and JSON fields compatible when changing only the toolkit version.

The stable local paths remain under `~/.pipker/slothtool/`: Profiles and Keys in `plugin-configs/slothvault.json`, redacted history in `data/slothvault/`, and runtime versions in `runtimes/slothvault/`. The runtime installs links only for detected agents and never replaces custom Skill targets during automatic updates.

## Local checks

```bash
npm ci --ignore-scripts
npm test
PYTHONDONTWRITEBYTECODE=1 python3 deploy/tests/deploy_installer_test.py
node scripts/skill-metadata.js --check
npm pack --dry-run
```

The toolkit Release workflow runs these checks and publishes the package. A toolkit-only change does not advance the application version or build a Docker image.
