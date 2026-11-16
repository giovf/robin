import { createHash } from "node:crypto";
import path from "node:path";

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
  /**
   * One vector per input text, in order. `kind` says whether the texts are
   * stored content or a search query; some models embed the two differently.
   */
  embed(texts: string[], kind: EmbeddingKind): Promise<number[][]>;
}

export type EmbeddingKind = "document" | "query";

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Test stand-in: hashes words and word pairs into a fixed-size vector (the
 * "hashing trick"). Instant and deterministic, but it only matches texts that
 * share words — it does not understand meaning. Selected with
 * EMBEDDINGS_PROVIDER=local-hash; the test suite uses it.
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

const E5_MODEL = "Xenova/multilingual-e5-small";

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * The default: `multilingual-e5-small` (384 dimensions, ~100 languages) run
 * locally through ONNX. Free, and customer text never leaves the server. The
 * model (~120 MB) is downloaded once into `.cache/transformers`.
 */
export class LocalE5EmbeddingProvider implements EmbeddingProvider {
  readonly id = "multilingual-e5-small-q8";
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private extractor: Promise<FeatureExtractor> | undefined;

  private load(): Promise<FeatureExtractor> {
    this.extractor ??= (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = path.join(process.cwd(), ".cache", "transformers");
      const extractor = await pipeline("feature-extraction", E5_MODEL, {
        dtype: "q8",
      });
      return extractor as unknown as FeatureExtractor;
    })();
    // A failed download must not poison every later call.
    this.extractor.catch(() => (this.extractor = undefined));
    return this.extractor;
  }

  async embed(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
    if (!texts.length) return [];
    const extractor = await this.load();
    // E5 models are trained with these prefixes; without them quality drops.
    const prefix = kind === "query" ? "query: " : "passage: ";
    const output = await extractor(
      texts.map((text) => prefix + text),
      { pooling: "mean", normalize: true },
    );
    return output.tolist();
  }
}

let provider: EmbeddingProvider | undefined;

/** The configured embeddings provider (EMBEDDINGS_PROVIDER; default local E5). */
export function getEmbeddingProvider(): EmbeddingProvider {
  provider ??=
    process.env.EMBEDDINGS_PROVIDER === "local-hash"
      ? new LocalHashEmbeddingProvider()
      : new LocalE5EmbeddingProvider();
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

const BATCH_SIZE = 16;

/** Embeds any number of stored texts, in provider-sized batches. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const embedder = getEmbeddingProvider();
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = await embedder.embed(
      texts.slice(start, start + BATCH_SIZE),
      "document",
    );
    if (batch.length !== Math.min(BATCH_SIZE, texts.length - start)) {
      throw new Error(
        "Embedding provider returned the wrong number of vectors.",
      );
    }
    vectors.push(...batch);
  }
  return vectors;
}
