import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Native ONNX runtime for local embeddings: load from node_modules, don't bundle.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
