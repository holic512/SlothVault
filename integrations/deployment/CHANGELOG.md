# Deployment changes

## 1.1.0

- Check the running application, preview one fixed Release target and confirm once before pulling and recreating it.
- Stream measured Compose JSON/plain layer progress and separate five-second process heartbeats; classify errors without forwarding raw commands or stderr.
- Pull with private temporary configuration before activation. Preserve original configuration on failure before recreation; report actual state after recreation without automatic rollback.
- Verify the running image and embedded Release identity locally, with a bounded 120-second health check and explicit absent-health-check status. Do not re-query GitHub to declare success.
- Extend bridge major 1 with optional typed confirmation, preview, runtime-image snapshot and explicit final outcomes; return final snapshots after failure or cancellation.

## 1.0.0

- Published the Python deployment program independently of the MCP Client and Skill.
- Kept the JSON-line deployment bridge and raised the Python baseline to 3.10.
