-- Additive compatibility repair, introduced with the plugin-system release.
-- This migration deliberately sorts before 20260820: a fresh MySQL database
-- needs a replacement FK-supporting index before that immutable migration
-- drops uq_release_credential_version_network. Existing installations apply
-- this still-pending migration normally; no historical SQL/checksum changes.
CREATE INDEX `idx_release_credential_project_version_fk`
    ON `release_credential` (`project_version_id`);
