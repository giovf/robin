import { createHash } from "node:crypto";

import { EMBEDDING_DIMENSIONS } from "@/db/customer/schema";

/**
 * Turns text into vectors for similarity search. Sits behind an interface so
 * the provider can be chosen later (a PRD open question) and faked in tests.
 */
export interface EmbeddingProvider {
  /** Stored with every chunk, so a provider change can be detected. */
  readonly id: string;
  /** Must equal EMBEDDING_DIMENSIONS, the size of the database column. */
  readonly dimensions: number;
  /** One vector per input text, in order. */
  embed(texts: string[]): Promise<number[][]>;
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Development stand-in: hashes words and word pairs into a fixed-size vector
 * (the "hashing trick"). Runs locally, costs nothing and sends no customer
 * data anywhere — but it only matches texts that share words. It does NOT
 * understand meaning; replace it with a real embeddings model before relying
 * on retrieval quality.
 */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local-hash-v1";
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const words = tokens(text);
    const features = [
      ...words,
      ...words.slice(1).map((word, index) => `${words[index]} ${word}`),
    ];
    const counts = new Map<string, number>();
    for (const feature of features) {
      counts.set(feature, (counts.get(feature) ?? 0) + 1);
    }
    for (const [feature, count] of counts) {
      const hash = createHash("md5").update(feature).digest();
      const index = hash.readUInt32LE(0) % this.dimensions;
      const sign = hash[4] & 1 ? 1 : -1;
      vector[index] += sign * (1 + Math.log(count));
    }
    const norm = Math.hypot(...vector);
    // Cosine distance is undefined for a zero vector; give empty text a fixed one.
    if (norm === 0) {
      vector[0] = 1;
      return vector;
    }
    return vector.map((value) => value / norm);
  }
}

let provider: EmbeddingProvider | undefined;

/** The configured embeddings provider. Only the local stand-in exists so far. */
export function getEmbeddingProvider(): EmbeddingProvider {
  provider ??= new LocalHashEmbeddingProvider();
  return provider;
}

/** Replaces the provider (tests, or wiring up a real one). */
export function setEmbeddingProvider(
  next: EmbeddingProvider | undefined,
): void {
  if (next && next.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding provider "${next.id}" produces ${next.dimensions} dimensions; the database column holds ${EMBEDDING_DIMENSIONS}.`,
    );
  }
  provider = next;
}

const BATCH_SIZE = 64;

/** Embeds any number of texts, in provider-sized batches. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const embedder = getEmbeddingProvider();
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = await embedder.embed(texts.slice(start, start + BATCH_SIZE));
    if (batch.length !== Math.min(BATCH_SIZE, texts.length - start)) {
      throw new Error(
        "Embedding provider returned the wrong number of vectors.",
      );
    }
    vectors.push(...batch);
  }
  return vectors;
}
