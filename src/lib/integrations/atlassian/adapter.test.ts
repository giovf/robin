import { describe, expect, it } from "vitest";

import { IntegrationError } from "../errors";
import type { OAuthTokens } from "../types";
import {
  adfToText,
  ATLASSIAN_PUBLISH_SCOPES,
  ATLASSIAN_SCOPES,
  AtlassianAdapter,
  storageToText,
} from "./adapter";

const TOKENS: OAuthTokens = { accessToken: "at-1", scopes: [] };
const REDIRECT = "http://localhost:3000/api/integrations/atlassian/callback";
const SITES = [
  {
    id: "cloud-1",
    name: "acme",
    url: "https://acme.atlassian.net",
    scopes: ["read:jira-work"],
  },
  {
    id: "cloud-1",
    name: "acme",
    url: "https://acme.atlassian.net",
    scopes: ["read:confluence-content.all"],
  },
  {
    id: "cloud-2",
    name: "beta",
    url: "https://beta.atlassian.net",
    scopes: ["read:jira-work"],
  },
];

interface Call {
  url: URL;
  init?: RequestInit;
}

function adapterWith(
  routes: [match: string, body: unknown, status?: number][],
): { adapter: AtlassianAdapter; calls: Call[] } {
  const calls: Call[] = [];
  const impl = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const route = routes.find(([match]) => url.toString().includes(match));
    if (!route) return new Response("no route", { status: 404 });
    return Response.json(route[1], { status: route[2] ?? 200 });
  };
  return {
    adapter: new AtlassianAdapter(
      { clientId: "cid", clientSecret: "shh" },
      impl as typeof fetch,
    ),
    calls,
  };
}

describe("text conversion", () => {
  it("flattens Atlassian Document Format", () => {
    expect(
      adfToText({
        type: "doc",
        content: [
          {
            type: "heading",
            content: [{ type: "text", text: "Goal" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Move to " },
              { type: "text", text: "the cloud" },
              { type: "hardBreak" },
              { type: "text", text: "by Q3" },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "SSO" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe("Goal\nMove to the cloud\nby Q3\nSSO");
    expect(adfToText(null)).toBe("");
    expect(adfToText("plain")).toBe("plain");
  });

  it("flattens Confluence storage format", () => {
    expect(
      storageToText(
        "<h1>Design</h1><p>Uses&nbsp;<strong>Kafka</strong> &amp; S3</p><ul><li>one</li><li>two</li></ul>",
      ),
    ).toBe("Design\nUses Kafka & S3\none\ntwo");
  });
});

describe("AtlassianAdapter OAuth", () => {
  it("requests read-only scopes by default", () => {
    const { adapter } = adapterWith([]);
    const url = new URL(
      adapter.getAuthorizationUrl({ state: "st", redirectUri: REDIRECT }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://auth.atlassian.com/authorize",
    );
    expect(url.searchParams.get("audience")).toBe("api.atlassian.com");
    expect(url.searchParams.get("prompt")).toBe("consent");
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual([...ATLASSIAN_SCOPES]);
    expect(scopes).toContain("offline_access");
    expect(scopes.some((scope) => scope.startsWith("write:"))).toBe(false);
    expect(
      ATLASSIAN_PUBLISH_SCOPES.every((scope) => scope.startsWith("write:")),
    ).toBe(true);
  });

  it("exchanges and refreshes with a JSON body, returning the rotated token", async () => {
    const { adapter, calls } = adapterWith([
      [
        "/oauth/token",
        {
          access_token: "at-2",
          refresh_token: "rt-rotated",
          expires_in: 3600,
          scope: "read:me read:jira-work",
        },
      ],
    ]);
    await adapter.exchangeCodeForTokens({
      code: "c0de",
      redirectUri: REDIRECT,
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      client_id: "cid",
      client_secret: "shh",
      grant_type: "authorization_code",
      code: "c0de",
      redirect_uri: REDIRECT,
    });
    const refreshed = await adapter.refreshTokens("rt-old");
    expect(refreshed.refreshToken).toBe("rt-rotated");
    expect(JSON.parse(String(calls[1].init?.body)).refresh_token).toBe(
      "rt-old",
    );
  });

  it("treats a rejected refresh as needing reconnection", async () => {
    const { adapter } = adapterWith([["/oauth/token", {}, 403]]);
    const error = await adapter.refreshTokens("revoked").catch((e) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.needsReauth).toBe(true);
  });

  it("labels the account with its sites", async () => {
    const { adapter } = adapterWith([
      ["/me", { account_id: "acc-1", email: "ada@example.test" }],
      ["accessible-resources", SITES],
    ]);
    expect(await adapter.getAccount(TOKENS)).toEqual({
      externalAccountId: "acc-1",
      label: "ada@example.test (acme, beta)",
    });
  });
});

describe("AtlassianAdapter sources", () => {
  it("lists Confluence spaces only for sites with Confluence access", async () => {
    const { adapter, calls } = adapterWith([
      ["accessible-resources", SITES],
      [
        "/ex/confluence/cloud-1/rest/api/space",
        { results: [{ key: "ARCH", name: "Architecture" }], _links: {} },
      ],
    ]);
    expect(await adapter.listSources(TOKENS, "confluence")).toEqual([
      {
        kind: "confluence",
        id: "cloud-1:ARCH",
        name: "Architecture (acme)",
        selector: { cloudId: "cloud-1", spaceKey: "ARCH" },
      },
    ]);
    expect(calls.filter((c) => c.url.pathname.includes("cloud-2"))).toEqual([]);
  });

  it("lists Jira projects across sites and pages", async () => {
    const { adapter, calls } = adapterWith([
      ["accessible-resources", SITES],
      [
        "/ex/jira/cloud-1/rest/api/3/project/search?maxResults=50&startAt=0",
        { values: [{ key: "ROB", name: "Robin" }], isLast: false },
      ],
      [
        "/ex/jira/cloud-1/rest/api/3/project/search?maxResults=50&startAt=50",
        { values: [{ key: "OPS", name: "Ops" }], isLast: true },
      ],
      [
        "/ex/jira/cloud-2/rest/api/3/project/search",
        { values: [{ key: "B", name: "Beta" }], isLast: true },
      ],
    ]);
    const projects = await adapter.listSources(TOKENS, "jira");
    expect(projects.map((p) => p.id)).toEqual([
      "cloud-2:B",
      "cloud-1:OPS",
      "cloud-1:ROB",
    ]);
    expect(
      calls.filter((c) => c.url.pathname.includes("project")),
    ).toHaveLength(3);
    expect(await adapter.listSources(TOKENS, "gmail")).toEqual([]);
  });
});

describe("AtlassianAdapter content", () => {
  it("fetches Confluence pages as text, with paging", async () => {
    const { adapter, calls } = adapterWith([
      [
        "/ex/confluence/cloud-1/rest/api/content",
        {
          results: [
            {
              id: "123",
              title: "Target architecture",
              body: { storage: { value: "<p>Event-driven</p>" } },
              version: { when: "2026-10-01T00:00:00Z" },
              _links: { webui: "/spaces/ARCH/pages/123" },
            },
          ],
          _links: { base: "https://acme.atlassian.net/wiki", next: "/more" },
        },
      ],
    ]);
    const page = await adapter.fetchContent(
      TOKENS,
      {
        kind: "confluence",
        selector: { cloudId: "cloud-1", spaceKey: "ARCH" },
      },
      "25",
    );
    expect(calls[0].url.searchParams.get("spaceKey")).toBe("ARCH");
    expect(calls[0].url.searchParams.get("start")).toBe("25");
    expect(page).toEqual({
      items: [
        {
          externalId: "123",
          title: "Target architecture",
          url: "https://acme.atlassian.net/wiki/spaces/ARCH/pages/123",
          text: "Event-driven",
          updatedAt: new Date("2026-10-01T00:00:00Z"),
        },
      ],
      nextPageToken: "26",
    });
  });

  it("fetches Jira issues with description and comments", async () => {
    const { adapter, calls } = adapterWith([
      ["accessible-resources", SITES],
      [
        "/ex/jira/cloud-1/rest/api/3/search/jql",
        {
          issues: [
            {
              key: "ROB-7",
              fields: {
                summary: "Choose message bus",
                status: { name: "In Progress" },
                issuetype: { name: "Story" },
                updated: "2026-11-01T00:00:00.000+0000",
                description: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Kafka or SQS?" }],
                    },
                  ],
                },
                comment: {
                  comments: [
                    {
                      author: { displayName: "Grace" },
                      body: {
                        type: "doc",
                        content: [
                          {
                            type: "paragraph",
                            content: [{ type: "text", text: "Kafka." }],
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          ],
          nextPageToken: "tok-2",
        },
      ],
    ]);
    const page = await adapter.fetchContent(TOKENS, {
      kind: "jira",
      selector: { cloudId: "cloud-1", projectKey: "ROB" },
    });
    const search = calls.find((c) => c.url.pathname.endsWith("/search/jql"))!;
    expect(search.url.searchParams.get("jql")).toBe(
      'project = "ROB" ORDER BY updated DESC',
    );
    expect(page.nextPageToken).toBe("tok-2");
    expect(page.items[0]).toMatchObject({
      externalId: "ROB-7",
      title: "ROB-7: Choose message bus",
      url: "https://acme.atlassian.net/browse/ROB-7",
    });
    expect(page.items[0].text).toBe(
      "ROB-7: Choose message bus\nType: Story · Status: In Progress\n\nKafka or SQS?\n\nComment by Grace:\nKafka.",
    );
  });

  it("rejects selectors that could alter the URL or JQL", async () => {
    const { adapter, calls } = adapterWith([]);
    await expect(
      adapter.fetchContent(TOKENS, {
        kind: "jira",
        selector: { cloudId: "cloud-1", projectKey: 'X" OR project != "X' },
      }),
    ).rejects.toThrow(/valid project/);
    await expect(
      adapter.fetchContent(TOKENS, {
        kind: "confluence",
        selector: { cloudId: "../evil", spaceKey: "ARCH" },
      }),
    ).rejects.toThrow(/valid site/);
    expect(calls).toHaveLength(0);
  });
});

describe("AtlassianAdapter publish", () => {
  it("creates a Confluence page with escaped content", async () => {
    const { adapter, calls } = adapterWith([
      [
        "/ex/confluence/cloud-1/rest/api/content",
        {
          id: "900",
          _links: { base: "https://acme.atlassian.net/wiki", webui: "/p/900" },
        },
      ],
    ]);
    const result = await adapter.publish(TOKENS, {
      target: { kind: "confluence", cloudId: "cloud-1", spaceKey: "ARCH" },
      title: "Discovery summary",
      body: "Line one\nLine two\n\n<script>x</script> & more",
    });
    expect(result).toEqual({
      externalId: "900",
      url: "https://acme.atlassian.net/wiki/p/900",
    });
    expect(calls[0].init?.method).toBe("POST");
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent.space).toEqual({ key: "ARCH" });
    expect(sent.body.storage.value).toBe(
      "<p>Line one<br />Line two</p><p>&lt;script&gt;x&lt;/script&gt; &amp; more</p>",
    );
  });

  it("creates a Jira issue", async () => {
    const { adapter, calls } = adapterWith([
      ["accessible-resources", SITES],
      ["/ex/jira/cloud-1/rest/api/3/issue", { key: "ROB-8" }],
    ]);
    const result = await adapter.publish(TOKENS, {
      target: { kind: "jira", cloudId: "cloud-1", projectKey: "ROB" },
      title: "Follow up on SSO",
      body: "Ask about IdP.",
    });
    expect(result).toEqual({
      externalId: "ROB-8",
      url: "https://acme.atlassian.net/browse/ROB-8",
    });
    const post = calls.find((c) => c.init?.method === "POST")!;
    const sent = JSON.parse(String(post.init?.body));
    expect(sent.fields.project).toEqual({ key: "ROB" });
    expect(sent.fields.issuetype).toEqual({ name: "Task" });
    expect(sent.fields.description.content[0].content[0].text).toBe(
      "Ask about IdP.",
    );
  });
});
