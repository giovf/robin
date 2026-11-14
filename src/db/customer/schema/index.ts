/**
 * Customer schema, applied to every per-customer database: solutions, calls,
 * transcripts, documents, ingested sources, embeddings, agent configuration
 * and memory.
 *
 * Code using these tables must get its connection through the
 * customer-connection resolver. Re-export every customer table from here.
 *
 * Requires the pgvector extension; the first customer migration enables it.
 */
export * from "./agent";
export * from "./calls";
export * from "./chunks";
export * from "./diagrams";
export * from "./documents";
export * from "./solutions";
export * from "./source-items";
export * from "./suggestions";
export * from "./transcript-segments";
