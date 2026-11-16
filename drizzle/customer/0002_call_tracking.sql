ALTER TABLE "calls" ADD COLUMN "bot_status_detail" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "transcript_indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "delivery_id" text;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_delivery_id_unique" UNIQUE("delivery_id");