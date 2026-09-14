CREATE TABLE `warranties` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT 1 NOT NULL,
	`product_name` text NOT NULL,
	`brand` text,
	`retailer` text,
	`serial` text,
	`purchased_on` integer NOT NULL,
	`months` integer DEFAULT 12 NOT NULL,
	`expires_on` integer NOT NULL,
	`price_minor` integer,
	`currency` text,
	`photos` text,
	`notes` text,
	`transaction_id` text
);
--> statement-breakpoint
CREATE INDEX `warranty_expiry_idx` ON `warranties` (`expires_on`);