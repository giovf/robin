import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { requireEnv } from "@/db/env";

/*
 * AES-256-GCM encryption for secrets stored in the database (OAuth tokens).
 * Stored format: `v1:<iv>:<auth tag>:<ciphertext>`, each part base64.
 * The version prefix leaves room for key rotation or an algorithm change.
 */
const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function key(): Buffer {
  const decoded = Buffer.from(requireEnv("TOKEN_ENCRYPTION_KEY"), "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).",
    );
  }
  return decoded;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(":");
}

/** @throws if the value is malformed, was tampered with, or the key is wrong. */
export function decryptToken(encrypted: string): string {
  const [version, iv, authTag, ciphertext, ...rest] = encrypted.split(":");
  if (
    version !== VERSION ||
    !iv ||
    !authTag ||
    ciphertext === undefined ||
    rest.length
  ) {
    throw new Error("Encrypted token has an unknown format.");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
