ALTER TABLE "customer_sources" ADD COLUMN "last_sync_status" text;--> statement-breakpoint
ALTER TABLE "customer_sources" ADD COLUMN "last_sync_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_sources" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_sources" ADD COLUMN "last_sync_item_count" integer;--> statement-breakpoint
ALTER TABLE "customer_sources" ADD COLUMN "last_sync_error" text;