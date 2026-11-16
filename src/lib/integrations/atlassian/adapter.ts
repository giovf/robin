import { IntegrationError } from "../errors";
import type {
  ConnectedAccount,
  ContentItem,
  CustomerSourceKind,
  FetchedContent,
  IntegrationAdapter,
  IntegrationSource,
  OAuthTokens,
  PublishContent,
  PublishResult,
} from "../types";

/*
 * Atlassian Cloud (Confluence, Jira) over OAuth 2.0 (3LO) + REST with fetch.
 * One connection can cover several sites, so every selector carries the
 * site's cloud id.
 */

const AUTH_URL = "https://auth.atlassian.com/authorize";
const TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const API = "https://api.atlassian.com";

/** Read-only scopes requested when connecting. */
export const ATLASSIAN_SCOPES = [
  "offline_access",
  "read:me",
  "read:confluence-space.summary",
  "read:confluence-content.all",
  "read:jira-work",
] as const;

/**
 * Extra scopes needed by `publish`. Not requested by default (least
 * privilege): a connection must be made with these before publishing works.
 */
export const ATLASSIAN_PUBLISH_SCOPES = [
  "write:confluence-content",
  "write:jira-work",
] as const;

const PAGE_SIZE = 25;
const MAX_SOURCES = 500;

export interface ConfluenceSelector {
  cloudId: string;
  spaceKey: string;
}
export interface JiraSelector {
  cloudId: string;
  projectKey: string;
}

export interface AtlassianAdapterConfig {
  clientId: string;
  clientSecret: string;
}

interface Site {
  id: string;
  name: string;
  url: string;
  scopes: string[];
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/** A node of the Atlassian Document Format (Jira rich text). */
interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

const ADF_BLOCKS = new Set([
  "paragraph",
  "heading",
  "listItem",
  "blockquote",
  "codeBlock",
  "tableRow",
  "rule",
]);

/** Flattens Atlassian Document Format to plain text. */
export function adfToText(node: AdfNode | string | null | undefined): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  const walk = (current: AdfNode): string => {
    if (current.type === "text") return current.text ?? "";
    if (current.type === "hardBreak") return "\n";
    const inner = (current.content ?? []).map(walk).join("");
    return ADF_BLOCKS.has(current.type ?? "") ? `${inner}\n` : inner;
  };
  return walk(node)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** Flattens Confluence storage format (XHTML) to plain text. */
export function storageToText(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|li|tr|div|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity])
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Site ids and keys end up in URLs and JQL: allow only what they look like. */
function safe(value: unknown, label: string): string {
  const text = str(value);
  if (!/^[\w-]+$/.test(text)) {
    throw new IntegrationError(`Atlassian source has no valid ${label}.`);
  }
  return text;
}

export class AtlassianAdapter implements IntegrationAdapter {
  readonly provider = "atlassian" as const;
  readonly sourceKinds = ["confluence", "jira"] as const;
  readonly defaultScopes = ATLASSIAN_SCOPES;
  readonly publishScopes = ATLASSIAN_PUBLISH_SCOPES;

  constructor(
    private readonly config: AtlassianAdapterConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  // ── OAuth ────────────────────────────────────────────────────────────────

  getAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    scopes?: readonly string[];
  }): string {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: this.config.clientId,
      scope: (input.scopes ?? this.defaultScopes).join(" "),
      redirect_uri: input.redirectUri,
      state: input.state,
      response_type: "code",
      prompt: "consent",
    }).toString();
    return url.toString();
  }

  async exchangeCodeForTokens(input: {
    code: string;
    redirectUri: string;
  }): Promise<OAuthTokens> {
    return this.token({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    });
  }

  /** Atlassian rotates refresh tokens: the result carries a new one to store. */
  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    return this.token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  async getAccount(tokens: OAuthTokens): Promise<ConnectedAccount> {
    const me = await this.get<{ account_id: string; email?: string }>(
      tokens,
      `${API}/me`,
    );
    const sites = await this.sites(tokens);
    const where = sites.map((site) => site.name).join(", ");
    const who = me.email ?? me.account_id;
    return {
      externalAccountId: me.account_id,
      label: where ? `${who} (${where})` : who,
    };
  }

  // ── Source discovery ─────────────────────────────────────────────────────

  async listSources(
    tokens: OAuthTokens,
    kind: CustomerSourceKind,
  ): Promise<IntegrationSource[]> {
    if (kind !== "confluence" && kind !== "jira") return [];
    const sources: IntegrationSource[] = [];
    for (const site of await this.sites(tokens, kind)) {
      const found =
        kind === "confluence"
          ? await this.confluenceSpaces(tokens, site)
          : await this.jiraProjects(tokens, site);
      sources.push(...found);
      if (sources.length >= MAX_SOURCES) break;
    }
    return sources.sort((x, y) => x.name.localeCompare(y.name));
  }

  /** Sites the token can reach, one entry per site, optionally per product. */
  private async sites(
    tokens: OAuthTokens,
    product?: "confluence" | "jira",
  ): Promise<Site[]> {
    const resources = await this.get<Site[]>(
      tokens,
      `${API}/oauth/token/accessible-resources`,
    );
    // The same site is listed once per product; tell them apart by scope.
    const byId = new Map<string, Site>();
    for (const site of resources) {
      const matches =
        !product || site.scopes.some((scope) => scope.includes(product));
      if (matches && !byId.has(site.id)) byId.set(site.id, site);
    }
    return [...byId.values()];
  }

  private async confluenceSpaces(
    tokens: OAuthTokens,
    site: Site,
  ): Promise<IntegrationSource[]> {
    const spaces: IntegrationSource[] = [];
    for (let start = 0; spaces.length < MAX_SOURCES; start += 100) {
      const page = await this.get<{
        results?: { key: string; name: string }[];
        _links?: { next?: string };
      }>(tokens, `${API}/ex/confluence/${site.id}/rest/api/space`, {
        limit: "100",
        start: String(start),
      });
      for (const space of page.results ?? []) {
        spaces.push({
          kind: "confluence",
          id: `${site.id}:${space.key}`,
          name: `${space.name} (${site.name})`,
          selector: {
            cloudId: site.id,
            spaceKey: space.key,
          } satisfies ConfluenceSelector,
        });
      }
      if (!page._links?.next || !page.results?.length) break;
    }
    return spaces;
  }

  private async jiraProjects(
    tokens: OAuthTokens,
    site: Site,
  ): Promise<IntegrationSource[]> {
    const projects: IntegrationSource[] = [];
    for (let startAt = 0; projects.length < MAX_SOURCES; startAt += 50) {
      const page = await this.get<{
        values?: { key: string; name: string }[];
        isLast?: boolean;
      }>(tokens, `${API}/ex/jira/${site.id}/rest/api/3/project/search`, {
        maxResults: "50",
        startAt: String(startAt),
      });
      for (const project of page.values ?? []) {
        projects.push({
          kind: "jira",
          id: `${site.id}:${project.key}`,
          name: `${project.name} (${site.name})`,
          selector: {
            cloudId: site.id,
            projectKey: project.key,
          } satisfies JiraSelector,
        });
      }
      if (page.isLast !== false || !page.values?.length) break;
    }
    return projects;
  }

  // ── Content ──────────────────────────────────────────────────────────────

  async fetchContent(
    tokens: OAuthTokens,
    source: Pick<IntegrationSource, "kind" | "selector">,
    pageToken?: string,
  ): Promise<FetchedContent> {
    const cloudId = safe(source.selector.cloudId, "site");
    if (source.kind === "confluence") {
      const spaceKey = safe(source.selector.spaceKey, "space");
      return this.fetchConfluence(tokens, cloudId, spaceKey, pageToken);
    }
    if (source.kind === "jira") {
      const projectKey = safe(source.selector.projectKey, "project");
      return this.fetchJira(tokens, cloudId, projectKey, pageToken);
    }
    throw new IntegrationError(`Atlassian cannot supply "${source.kind}".`);
  }

  private async fetchConfluence(
    tokens: OAuthTokens,
    cloudId: string,
    spaceKey: string,
    pageToken?: string,
  ): Promise<FetchedContent> {
    const start = pageToken ? Number(pageToken) : 0;
    const page = await this.get<{
      results?: {
        id: string;
        title: string;
        body?: { storage?: { value?: string } };
        version?: { when?: string };
        _links?: { webui?: string };
      }[];
      _links?: { base?: string; next?: string };
    }>(tokens, `${API}/ex/confluence/${cloudId}/rest/api/content`, {
      spaceKey,
      type: "page",
      expand: "body.storage,version",
      limit: String(PAGE_SIZE),
      start: String(start),
    });
    const results = page.results ?? [];
    const items: ContentItem[] = results.map((result) => ({
      externalId: result.id,
      title: result.title,
      url:
        page._links?.base && result._links?.webui
          ? page._links.base + result._links.webui
          : undefined,
      text: storageToText(result.body?.storage?.value ?? ""),
      updatedAt: result.version?.when
        ? new Date(result.version.when)
        : undefined,
    }));
    return {
      items,
      nextPageToken:
        page._links?.next && results.length
          ? String(start + results.length)
          : undefined,
    };
  }

  private async fetchJira(
    tokens: OAuthTokens,
    cloudId: string,
    projectKey: string,
    pageToken?: string,
  ): Promise<FetchedContent> {
    const [site] = (await this.sites(tokens)).filter((s) => s.id === cloudId);
    const page = await this.get<{
      issues?: {
        key: string;
        fields?: {
          summary?: string;
          description?: AdfNode | string | null;
          updated?: string;
          status?: { name?: string };
          issuetype?: { name?: string };
          comment?: {
            comments?: {
              author?: { displayName?: string };
              body?: AdfNode | string;
            }[];
          };
        };
      }[];
      nextPageToken?: string;
    }>(tokens, `${API}/ex/jira/${cloudId}/rest/api/3/search/jql`, {
      jql: `project = "${projectKey}" ORDER BY updated DESC`,
      fields: "summary,description,status,issuetype,updated,comment",
      maxResults: String(PAGE_SIZE),
      ...(pageToken ? { nextPageToken: pageToken } : {}),
    });
    const items: ContentItem[] = (page.issues ?? []).map((issue) => {
      const fields = issue.fields ?? {};
      const comments = (fields.comment?.comments ?? []).map(
        (comment) =>
          `Comment by ${comment.author?.displayName ?? "unknown"}:\n${adfToText(comment.body)}`,
      );
      return {
        externalId: issue.key,
        title: `${issue.key}: ${fields.summary ?? ""}`,
        url: site ? `${site.url}/browse/${issue.key}` : undefined,
        text: [
          `${issue.key}: ${fields.summary ?? ""}`,
          `Type: ${fields.issuetype?.name ?? ""} · Status: ${fields.status?.name ?? ""}`,
          "",
          adfToText(fields.description),
          ...comments.flatMap((comment) => ["", comment]),
        ]
          .join("\n")
          .trim(),
        updatedAt: fields.updated ? new Date(fields.updated) : undefined,
      };
    });
    return { items, nextPageToken: page.nextPageToken };
  }

  // ── Publishing ───────────────────────────────────────────────────────────

  /**
   * Creates a Confluence page (`target: { kind: "confluence", cloudId,
   * spaceKey }`) or a Jira issue (`target: { kind: "jira", cloudId,
   * projectKey, issueType? }`) from plain text.
   *
   * WRITES TO THE CUSTOMER'S SYSTEM. Call only after the user has reviewed
   * the content and explicitly confirmed. Needs ATLASSIAN_PUBLISH_SCOPES.
   */
  async publish(
    tokens: OAuthTokens,
    content: PublishContent,
  ): Promise<PublishResult> {
    const cloudId = safe(content.target.cloudId, "site");
    const paragraphs = content.body.split(/\n{2,}/).filter(Boolean);

    if (content.target.kind === "confluence") {
      const created = await this.post<{
        id: string;
        _links?: { base?: string; webui?: string };
      }>(tokens, `${API}/ex/confluence/${cloudId}/rest/api/content`, {
        type: "page",
        title: content.title,
        space: { key: safe(content.target.spaceKey, "space") },
        body: {
          storage: {
            representation: "storage",
            value:
              content.bodyHtml ??
              paragraphs
                .map(
                  (paragraph) =>
                    `<p>${escapeHtml(paragraph).replaceAll("\n", "<br />")}</p>`,
                )
                .join(""),
          },
        },
      });
      return {
        externalId: created.id,
        url: (created._links?.base ?? "") + (created._links?.webui ?? ""),
      };
    }

    if (content.target.kind === "jira") {
      const [site] = (await this.sites(tokens)).filter((s) => s.id === cloudId);
      const created = await this.post<{ key: string }>(
        tokens,
        `${API}/ex/jira/${cloudId}/rest/api/3/issue`,
        {
          fields: {
            project: { key: safe(content.target.projectKey, "project") },
            summary: content.title,
            issuetype: { name: str(content.target.issueType) || "Task" },
            description: {
              type: "doc",
              version: 1,
              content: paragraphs.map((paragraph) => ({
                type: "paragraph",
                content: [{ type: "text", text: paragraph }],
              })),
            },
          },
        },
      );
      return {
        externalId: created.key,
        url: site ? `${site.url}/browse/${created.key}` : "",
      };
    }

    throw new IntegrationError("Unknown Atlassian publish target.");
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  private async token(params: Record<string, string>): Promise<OAuthTokens> {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...params,
      }),
    });
    if (!response.ok) {
      // 403 here means the refresh token was revoked or expired.
      throw new IntegrationError(
        `Atlassian token request failed (${response.status}).`,
        response.status === 403 ? 401 : response.status,
      );
    }
    const data = (await response.json()) as TokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
      scopes: data.scope ? data.scope.split(" ") : [],
    };
  }

  private async send<T>(
    tokens: OAuthTokens,
    url: URL,
    init: RequestInit,
  ): Promise<T> {
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        Accept: "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new IntegrationError(
        `Atlassian API request failed (${response.status}) for ${url.pathname}.`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  private async get<T>(
    tokens: OAuthTokens,
    url: string,
    query?: Record<string, string>,
  ): Promise<T> {
    const target = new URL(url);
    for (const [name, value] of Object.entries(query ?? {})) {
      target.searchParams.set(name, value);
    }
    return this.send<T>(tokens, target, {});
  }

  private async post<T>(
    tokens: OAuthTokens,
    url: string,
    body: unknown,
  ): Promise<T> {
    return this.send<T>(tokens, new URL(url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}
