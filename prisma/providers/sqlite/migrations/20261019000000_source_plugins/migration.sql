-- Source-only plugin release boundary.
-- Legacy card retirement runs under the host maintenance gate after migrations,
-- checking actual external references before dropping the fixed historical tables.
SELECT 1;
