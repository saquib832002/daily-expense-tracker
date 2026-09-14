CREATE TABLE `loyalty_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`symbology` text DEFAULT 'unknown' NOT NULL,
	`notes` text,
	`colour` text,
	`photos` text,
	`used_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE INDEX `loyalty_name_idx` ON `loyalty_cards` (`name`);