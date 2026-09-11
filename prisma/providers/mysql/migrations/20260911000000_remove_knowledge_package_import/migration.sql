CREATE TEMPORARY TABLE `knowledge_package_project_versions_to_remove` AS
SELECT DISTINCT `project_version_id` AS `id`
FROM `knowledge_package`
WHERE `package_kind` = 'project';

DELETE FROM `release_credential`
WHERE `project_version_id` IN (
  SELECT `id` FROM `knowledge_package_project_versions_to_remove`
)
OR `note_content_id` IN (
  SELECT `id`
  FROM `docs_note_content`
  WHERE `note_info_id` IN (SELECT `note_info_id` FROM `knowledge_article`)
);

DELETE FROM `docs_note_content`
WHERE `note_info_id` IN (SELECT `note_info_id` FROM `knowledge_article`)
OR `note_info_id` IN (
  SELECT `docs_note_info`.`id`
  FROM `docs_note_info`
  INNER JOIN `collections_category`
    ON `collections_category`.`id` = `docs_note_info`.`category_id`
  WHERE `collections_category`.`project_version_id` IN (
    SELECT `id` FROM `knowledge_package_project_versions_to_remove`
  )
);

DELETE FROM `docs_note_info`
WHERE `id` IN (SELECT `note_info_id` FROM `knowledge_article`)
OR `category_id` IN (
  SELECT `id`
  FROM `collections_category`
  WHERE `project_version_id` IN (
    SELECT `id` FROM `knowledge_package_project_versions_to_remove`
  )
);

DELETE FROM `collections_category`
WHERE `project_version_id` IN (
  SELECT `id` FROM `knowledge_package_project_versions_to_remove`
);

DELETE FROM `collections_project_version`
WHERE `id` IN (
  SELECT `id` FROM `knowledge_package_project_versions_to_remove`
);

DELETE FROM `knowledge_package`;

DROP TEMPORARY TABLE `knowledge_package_project_versions_to_remove`;
DROP TABLE `knowledge_article`;
DROP TABLE `knowledge_package`;
