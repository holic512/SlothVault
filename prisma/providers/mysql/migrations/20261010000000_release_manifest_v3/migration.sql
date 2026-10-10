ALTER TABLE `collections_project_version` ADD COLUMN `release_manifest_json` LONGTEXT NULL;

-- Retired content evidence is detached from current v3 publication credentials.
DELETE FROM release_credential_attempt WHERE credential_id IN (SELECT id FROM release_credential WHERE subject_type <> 'PROJECT_VERSION' OR subject_manifest_version <> 3);
DELETE FROM release_credential WHERE subject_type <> 'PROJECT_VERSION' OR subject_manifest_version <> 3;
