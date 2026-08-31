DROP INDEX `stream_external_id_idx`;--> statement-breakpoint
UPDATE `stream`
SET `external_id` = NULL
WHERE `external_source` IS NOT NULL
  AND `external_id` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `stream` AS `keeper`
    WHERE `keeper`.`external_source` = `stream`.`external_source`
      AND `keeper`.`external_id` = `stream`.`external_id`
      AND (
        `keeper`.`created_at` < `stream`.`created_at`
        OR (
          `keeper`.`created_at` = `stream`.`created_at`
          AND `keeper`.`id` < `stream`.`id`
        )
      )
  );--> statement-breakpoint
CREATE UNIQUE INDEX `stream_external_id_uq` ON `stream` (`external_source`,`external_id`) WHERE "stream"."external_source" IS NOT NULL AND "stream"."external_id" IS NOT NULL;
