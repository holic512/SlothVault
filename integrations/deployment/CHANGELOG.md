# Deployment changes

## 1.1.2

- Keep bridge final-event codes aligned with real process exits for unknown actions, unknown options, missing argument values, help and version queries.
- Report argument failures explicitly and include bootstrap argument parsing within the JSON event boundary.
- Add subprocess regressions for command and parameter compatibility, including future actions and options, while retaining bridge major 1.

## 1.1.1

- Discover host and Docker Nginx from actual execution context and loaded configuration, without an image-name allowlist.
- Locate the SlothVault server among multiple sites and map active Docker configuration to directory or single-file bind mounts.
- Add site-scoped status and transfer updates, persistent target selection, preview verification, private backups and explicit rollback results.
- Remove proxy body limits for backup uploads, stream downloads and align finite multipart/commission limits without reducing higher existing limits.
- Extend bridge major 1 with optional Nginx instance, site and transfer fields and add real isolated Nginx transfer verification in CI.

## 1.1.0

- Check the running application, preview one fixed Release target and confirm once before pulling and recreating it.
- Stream measured Compose JSON/plain layer progress and separate five-second process heartbeats; classify errors without forwarding raw commands or stderr.
- Pull with private temporary configuration before activation. Preserve original configuration on failure before recreation; report actual state after recreation without automatic rollback.
- Verify the running image and embedded Release identity locally, with a bounded 120-second health check and explicit absent-health-check status. Do not re-query GitHub to declare success.
- Extend bridge major 1 with optional typed confirmation, preview, runtime-image snapshot and explicit final outcomes; return final snapshots after failure or cancellation.

## 1.0.0

- Published the Python deployment program independently of the MCP Client and Skill.
- Kept the JSON-line deployment bridge and raised the Python baseline to 3.10.
