-- Embedding size changes from the 1536 placeholder to 384 (multilingual-e5-small).
-- Existing vectors cannot be converted: clear them; the next sync or upload
-- re-embeds, because chunks record which model produced their vector.
DROP INDEX IF EXISTS "chunks_embedding_idx";--> statement-breakpoint
UPDATE "chunks" SET "embedding" = NULL, "embedding_model" = NULL;--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(384);--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);
