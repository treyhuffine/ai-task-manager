ALTER TABLE `user_state` ADD `default_variant` text;--> statement-breakpoint
-- The variant used to come from the default harness's own row. Keep it where
-- the home's model is that row's model, so nothing a home runs on changes.
UPDATE `user_state` SET `default_variant` = (
  SELECT `harness_settings`.`default_variant` FROM `harness_settings`
  WHERE `harness_settings`.`harness` = `user_state`.`default_harness`
    AND `harness_settings`.`default_model` = `user_state`.`default_model`
) WHERE `default_harness` IS NOT NULL AND `default_model` IS NOT NULL;
