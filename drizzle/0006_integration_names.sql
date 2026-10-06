ALTER TABLE `workspaces` RENAME COLUMN "connector_scopes" TO "integration_scopes";--> statement-breakpoint
UPDATE `notification_channels` SET `kind` = 'integration' WHERE `kind` = 'connector';--> statement-breakpoint
UPDATE `notification_channels`
SET `events` = replace(`events`, '"connector.approval_required"', '"integration.approval_required"')
WHERE instr(`events`, '"connector.approval_required"') > 0;--> statement-breakpoint
UPDATE `notification_deliveries`
SET `event_type` = 'integration.approval_required',
    `dedupe_key` = replace(`dedupe_key`, 'connector.approval_required:', 'integration.approval_required:'),
    `event` = json_set(`event`, '$.type', 'integration.approval_required',
      '$.dedupeKey', replace(json_extract(`event`, '$.dedupeKey'), 'connector.approval_required:', 'integration.approval_required:'))
WHERE `event_type` = 'connector.approval_required';
