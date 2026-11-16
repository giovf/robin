import type { IntegrationAdapter, IntegrationProvider } from "./types";

const adapters = new Map<IntegrationProvider, IntegrationAdapter>();

/** Registers (or, in tests, replaces) the adapter for a provider. */
export function registerAdapter(adapter: IntegrationAdapter): void {
  adapters.set(adapter.provider, adapter);
}

/** @throws if no adapter is registered for the provider. */
export function getAdapter(provider: IntegrationProvider): IntegrationAdapter {
  const adapter = adapters.get(provider);
  if (!adapter) {
    throw new Error(`No integration adapter registered for "${provider}".`);
  }
  return adapter;
}

export function hasAdapter(provider: IntegrationProvider): boolean {
  return adapters.has(provider);
}

export function listAdapters(): IntegrationAdapter[] {
  return [...adapters.values()];
}

/** Removes all adapters. For tests. */
export function clearAdapters(): void {
  adapters.clear();
}
