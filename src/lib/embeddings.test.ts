import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/db/customer/schema";

import { LocalE5EmbeddingProvider } from "./embeddings";

// Needs the ~120 MB model. Runs when it is already downloaded (it is after
// the app's first upload or search) or when EMBEDDINGS_MODEL_TEST=1.
const available =
  process.env.EMBEDDINGS_MODEL_TEST === "1" ||
  existsSync(path.join(process.cwd(), ".cache", "transformers"));

describe.skipIf(!available)("local E5 embeddings (real model)", () => {
  it("matches by meaning, across languages", async () => {
    const provider = new LocalE5EmbeddingProvider();
    const [query] = await provider.embed(
      ["why did the Kafka project stall"],
      "query",
    );
    const [english, italian, unrelated] = await provider.embed(
      [
        "The event streaming initiative was paused in 2024 after the lead engineer left.",
        "Il progetto di streaming di eventi è stato sospeso dopo le dimissioni del responsabile.",
        "The canteen serves soup and sandwiches on Fridays.",
      ],
      "document",
    );
    const dot = (x: number[], y: number[]): number =>
      x.reduce((sum, value, i) => sum + value * y[i], 0);

    expect(query).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(dot(query, query)).toBeCloseTo(1, 3);
    // No words in common with the query, yet both beat the unrelated text.
    expect(dot(query, english)).toBeGreaterThan(dot(query, unrelated) + 0.05);
    expect(dot(query, italian)).toBeGreaterThan(dot(query, unrelated) + 0.05);
    expect(await provider.embed([], "document")).toEqual([]);
  }, 180_000);
});
