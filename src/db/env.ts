/**
 * Reads a required environment variable, failing loudly when it is missing so
 * a misconfigured process never silently connects to the wrong database.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env and set it.`,
    );
  }
  return value;
}
