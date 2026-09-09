CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'cash' NOT NULL,
	`opening_balance_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`icon` text,
	`color` text,
	`is_archived` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounts_archived_idx` ON `accounts` (`is_archived`,`sort_order`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT 1 NOT NULL,
	`category_id` text,
	`period` text DEFAULT 'monthly' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`starts_on` integer NOT NULL,
	`rollover` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budgets_category_idx` ON `budgets` (`category_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT 1 NOT NULL,
	`parent_id` text,
	`name_key` text,
	`custom_name` text,
	`icon` text,
	`color` text,
	`kind` text DEFAULT 'expense' NOT NULL,
	`is_system` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `categories_kind_idx` ON `categories` (`kind`,`sort_order`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`pair` text PRIMARY KEY NOT NULL,
	`rate` real NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `merchant_memory` (
	`merchant_key` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`hit_count` integer DEFAULT 1 NOT NULL,
	`last_used_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`op` text NOT NULL,
	`at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT 1 NOT NULL,
	`template_json` text NOT NULL,
	`rrule` text NOT NULL,
	`next_due_on` integer NOT NULL,
	`auto_post` integer DEFAULT 0 NOT NULL,
	`is_enabled` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recurring_due_idx` ON `recurring` (`is_enabled`,`next_due_on`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT 1 NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`match_type` text DEFAULT 'contains' NOT NULL,
	`match_value` text NOT NULL,
	`set_category_id` text,
	`set_account_id` text,
	`is_enabled` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rules_priority_idx` ON `rules` (`is_enabled`,`priority`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sms_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`pattern` text NOT NULL,
	`field_map_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sms_templates_active_idx` ON `sms_templates` (`is_active`);--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT 1 NOT NULL,
	`transaction_id` text NOT NULL,
	`category_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `splits_tx_idx` ON `transaction_splits` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT 1 NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`base_amount_minor` integer NOT NULL,
	`fx_rate` real DEFAULT 1 NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`occurred_at` integer NOT NULL,
	`merchant` text,
	`merchant_key` text,
	`note` text,
	`transfer_peer_id` text,
	`receipt_path` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`category_source` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`recurring_id` text
);
--> statement-breakpoint
CREATE INDEX `tx_occurred_idx` ON `transactions` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `tx_category_idx` ON `transactions` (`category_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `tx_account_idx` ON `transactions` (`account_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `tx_merchant_idx` ON `transactions` (`merchant_key`);--> statement-breakpoint
CREATE INDEX `tx_status_idx` ON `transactions` (`status`);