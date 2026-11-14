/**
 * Customer schema, applied to every per-customer database: solutions, calls,
 * transcripts, documents, ingested sources, embeddings, agent configuration
 * and memory.
 *
 * Code using these tables must get its connection through the
 * customer-connection resolver. Re-export every customer table from here.
 */
export {};
