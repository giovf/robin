import type {
  ConnectedAccount,
  ContentItem,
  CustomerSourceKind,
  FetchedContent,
  IntegrationAdapter,
  IntegrationProvider,
  IntegrationSource,
  OAuthTokens,
  PublishContent,
  PublishResult,
} from "./types";

export interface FakeAdapterOptions {
  provider?: IntegrationProvider;
  sources?: IntegrationSource[];
  /** Content per source id. */
  content?: Record<string, ContentItem[]>;
  pageSize?: number;
}

/**
 * In-memory adapter for tests and local development: no network, no
 * credentials. Records what was published in `published`.
 */
export class FakeIntegrationAdapter implements IntegrationAdapter {
  readonly provider: IntegrationProvider;
  readonly sourceKinds: readonly CustomerSourceKind[];
  readonly defaultScopes = ["fake.read"] as const;
  readonly published: PublishContent[] = [];
  private refreshCount = 0;

  constructor(private readonly options: FakeAdapterOptions = {}) {
    this.provider = options.provider ?? "google";
    this.sourceKinds = [
      ...new Set((options.sources ?? []).map((source) => source.kind)),
    ];
  }

  getAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    scopes?: readonly string[];
  }): string {
    const url = new URL("https://fake-provider.test/authorize");
    url.searchParams.set("state", input.state);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set(
      "scope",
      (input.scopes ?? this.defaultScopes).join(" "),
    );
    return url.toString();
  }

  async exchangeCodeForTokens(input: { code: string }): Promise<OAuthTokens> {
    if (input.code !== "valid-code") throw new Error("Invalid code.");
    return {
      accessToken: "fake-access-0",
      refreshToken: "fake-refresh",
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: [...this.defaultScopes],
    };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    if (refreshToken !== "fake-refresh") throw new Error("Invalid refresh.");
    this.refreshCount += 1;
    return {
      accessToken: `fake-access-${this.refreshCount}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: [...this.defaultScopes],
    };
  }

  async getAccount(): Promise<ConnectedAccount> {
    return { externalAccountId: "fake-account", label: "fake@example.test" };
  }

  async listSources(
    _tokens: OAuthTokens,
    kind: CustomerSourceKind,
  ): Promise<IntegrationSource[]> {
    return (this.options.sources ?? []).filter(
      (source) => source.kind === kind,
    );
  }

  async fetchContent(
    _tokens: OAuthTokens,
    source: Pick<IntegrationSource, "kind" | "selector">,
    pageToken?: string,
  ): Promise<FetchedContent> {
    const all = this.options.content?.[String(source.selector.id)] ?? [];
    const size = this.options.pageSize ?? 50;
    const start = pageToken ? Number(pageToken) : 0;
    const end = start + size;
    return {
      items: all.slice(start, end),
      nextPageToken: end < all.length ? String(end) : undefined,
    };
  }

  async publish(
    _tokens: OAuthTokens,
    content: PublishContent,
  ): Promise<PublishResult> {
    this.published.push(content);
    const externalId = `fake-${this.published.length}`;
    return { externalId, url: `https://fake-provider.test/${externalId}` };
  }
}
