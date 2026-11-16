import type {
  CustomerSourceKind,
  IntegrationProvider,
} from "@/db/control-plane/schema";

export type { CustomerSourceKind, IntegrationProvider };

/** Plaintext OAuth tokens. Never log or store these; storage encrypts them. */
export interface OAuthTokens {
  accessToken: string;
  /** Absent when the provider did not issue one (e.g. on a token refresh). */
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
}

/** The external account a set of tokens belongs to. */
export interface ConnectedAccount {
  /** Provider-side identifier (Google subject, Atlassian cloud id). */
  externalAccountId: string;
  /** Human-readable label, e.g. the account's email address or site name. */
  label: string;
}

/** Something the user can select as context for a customer. */
export interface IntegrationSource {
  kind: CustomerSourceKind;
  /** Provider's identifier: label id, folder id, space key, project key. */
  id: string;
  name: string;
  /** Stored as `customer_sources.selector` when the user selects it. */
  selector: Record<string, unknown>;
}

/** One fetched piece of content, ready to be chunked and embedded. */
export interface ContentItem {
  externalId: string;
  title: string;
  url?: string;
  /** Plain text. */
  text: string;
  updatedAt?: Date;
}

export interface FetchedContent {
  items: ContentItem[];
  /** Present when there is more to fetch. */
  nextPageToken?: string;
}

export interface PublishContent {
  /** Where to publish, e.g. a Confluence space key or Jira project key. */
  target: Record<string, unknown>;
  title: string;
  /** Plain text. */
  body: string;
  /** The same content as XHTML, for targets that accept rich text. */
  bodyHtml?: string;
}

export interface PublishResult {
  externalId: string;
  url: string;
}

/**
 * One external provider behind a common interface, so it can be faked in
 * tests and swapped. Adapters are stateless: tokens are passed in.
 */
export interface IntegrationAdapter {
  readonly provider: IntegrationProvider;
  /** Source kinds this provider can supply. */
  readonly sourceKinds: readonly CustomerSourceKind[];
  /** Read-only scopes requested when connecting. */
  readonly defaultScopes: readonly string[];
  /**
   * Extra scopes that allow `publish`. Requested only when the user chooses
   * to connect with publishing access.
   */
  readonly publishScopes?: readonly string[];

  // OAuth
  getAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    scopes?: readonly string[];
  }): string;
  exchangeCodeForTokens(input: {
    code: string;
    redirectUri: string;
  }): Promise<OAuthTokens>;
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
  getAccount(tokens: OAuthTokens): Promise<ConnectedAccount>;

  // Source discovery
  listSources(
    tokens: OAuthTokens,
    kind: CustomerSourceKind,
  ): Promise<IntegrationSource[]>;

  // Content fetching (read-only)
  fetchContent(
    tokens: OAuthTokens,
    source: Pick<IntegrationSource, "kind" | "selector">,
    pageToken?: string,
  ): Promise<FetchedContent>;

  /**
   * Writes to the customer's system. Callers must only invoke this after the
   * user has reviewed the content and explicitly confirmed.
   */
  publish?(
    tokens: OAuthTokens,
    content: PublishContent,
  ): Promise<PublishResult>;
}
