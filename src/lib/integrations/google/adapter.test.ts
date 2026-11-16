import { describe, expect, it } from "vitest";

import { IntegrationError } from "../errors";
import type { OAuthTokens } from "../types";
import { GoogleAdapter, GOOGLE_SCOPES } from "./adapter";

const TOKENS: OAuthTokens = { accessToken: "at-1", scopes: [] };
const REDIRECT = "http://localhost:3000/api/integrations/google/callback";

interface Call {
  url: URL;
  init?: RequestInit;
}

/** A fetch that answers from a list of [url-substring, response] routes. */
function fakeFetch(routes: [match: string, body: unknown, status?: number][]): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const impl = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const route = routes.find(([match]) => url.toString().includes(match));
    if (!route) return new Response("no route", { status: 404 });
    const [, body, status = 200] = route;
    return typeof body === "string"
      ? new Response(body, { status })
      : Response.json(body, { status });
  };
  return { fetch: impl as typeof fetch, calls };
}

function adapterWith(routes: Parameters<typeof fakeFetch>[0]): {
  adapter: GoogleAdapter;
  calls: Call[];
} {
  const { fetch, calls } = fakeFetch(routes);
  return {
    adapter: new GoogleAdapter({ clientId: "cid", clientSecret: "shh" }, fetch),
    calls,
  };
}

const b64 = (text: string): string => Buffer.from(text).toString("base64url");

describe("GoogleAdapter OAuth", () => {
  it("builds an authorization URL with read-only scopes and offline access", () => {
    const { adapter } = adapterWith([]);
    const url = new URL(
      adapter.getAuthorizationUrl({ state: "st4te", redirectUri: REDIRECT }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      ...GOOGLE_SCOPES,
    ]);
    for (const scope of GOOGLE_SCOPES.filter((s) => s.startsWith("https"))) {
      expect(scope).toMatch(/\.readonly$/);
    }
    expect(url.toString()).not.toContain("shh");
  });

  it("exchanges a code and refreshes tokens", async () => {
    const { adapter, calls } = adapterWith([
      [
        "oauth2.googleapis.com/token",
        {
          access_token: "at-new",
          refresh_token: "rt-new",
          expires_in: 3600,
          scope: "openid email",
        },
      ],
    ]);
    const before = Date.now();
    const tokens = await adapter.exchangeCodeForTokens({
      code: "c0de",
      redirectUri: REDIRECT,
    });
    expect(tokens).toMatchObject({
      accessToken: "at-new",
      refreshToken: "rt-new",
      scopes: ["openid", "email"],
    });
    expect(tokens.expiresAt!.getTime()).toBeGreaterThanOrEqual(
      before + 3_600_000,
    );
    const sent = new URLSearchParams(String(calls[0].init?.body));
    expect(Object.fromEntries(sent)).toEqual({
      client_id: "cid",
      client_secret: "shh",
      grant_type: "authorization_code",
      code: "c0de",
      redirect_uri: REDIRECT,
    });

    await adapter.refreshTokens("rt-old");
    const refresh = new URLSearchParams(String(calls[1].init?.body));
    expect(refresh.get("grant_type")).toBe("refresh_token");
    expect(refresh.get("refresh_token")).toBe("rt-old");
  });

  it("reports a rejected token request without leaking the response", async () => {
    const { adapter } = adapterWith([
      ["oauth2.googleapis.com/token", { error: "invalid_grant shh" }, 400],
    ]);
    const error = await adapter.refreshTokens("revoked").catch((e) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.needsReauth).toBe(true);
    expect(error.message).not.toContain("shh");
  });

  it("identifies the connected account", async () => {
    const { adapter, calls } = adapterWith([
      ["userinfo", { sub: "108", email: "ada@example.test" }],
    ]);
    expect(await adapter.getAccount(TOKENS)).toEqual({
      externalAccountId: "108",
      label: "ada@example.test",
    });
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(
      "Bearer at-1",
    );
  });
});

describe("GoogleAdapter sources", () => {
  it("lists Gmail labels, sorted", async () => {
    const { adapter } = adapterWith([
      [
        "/users/me/labels",
        {
          labels: [
            { id: "Label_2", name: "Globex" },
            { id: "Label_1", name: "Acme" },
          ],
        },
      ],
    ]);
    expect(await adapter.listSources(TOKENS, "gmail")).toEqual([
      {
        kind: "gmail",
        id: "Label_1",
        name: "Acme",
        selector: { labelIds: ["Label_1"] },
      },
      {
        kind: "gmail",
        id: "Label_2",
        name: "Globex",
        selector: { labelIds: ["Label_2"] },
      },
    ]);
  });

  it("lists Drive folders across pages", async () => {
    const { fetch, calls } = fakeFetch([]);
    const pages = [
      { files: [{ id: "f1", name: "Acme" }], nextPageToken: "p2" },
      { files: [{ id: "f2", name: "Beta" }] },
    ];
    const paged = (async (input: Parameters<typeof fetch>[0]) => {
      await fetch(input);
      return Response.json(pages[calls.length - 1]);
    }) as typeof fetch;
    const adapter = new GoogleAdapter(
      { clientId: "cid", clientSecret: "shh" },
      paged,
    );
    const folders = await adapter.listSources(TOKENS, "google_drive");
    expect(folders.map((folder) => folder.selector)).toEqual([
      { folderId: "f1" },
      { folderId: "f2" },
    ]);
    expect(calls[0].url.searchParams.get("q")).toContain(
      "application/vnd.google-apps.folder",
    );
    expect(calls[1].url.searchParams.get("pageToken")).toBe("p2");
  });

  it("offers nothing for kinds it does not supply", async () => {
    const { adapter, calls } = adapterWith([]);
    expect(await adapter.listSources(TOKENS, "jira")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("lists upcoming meetings that have a link", async () => {
    const { adapter, calls } = adapterWith([
      [
        "/calendars/primary/events",
        {
          items: [
            {
              id: "e1",
              summary: "Acme discovery",
              start: { dateTime: "2026-12-01T10:00:00Z" },
              hangoutLink: "https://meet.google.com/abc-defg-hij",
            },
            {
              id: "e2",
              summary: "Zoom in location",
              start: { dateTime: "2026-12-02T10:00:00Z" },
              location: "Join: https://acme.zoom.us/j/123456?pwd=x then talk",
            },
            {
              id: "e3",
              start: { dateTime: "2026-12-03T10:00:00Z" },
              conferenceData: {
                entryPoints: [
                  { entryPointType: "phone", uri: "tel:+1" },
                  {
                    entryPointType: "video",
                    uri: "https://teams.microsoft.com/l/meetup-join/xyz",
                  },
                ],
              },
            },
            { id: "e4", summary: "Lunch", start: { date: "2026-12-04" } },
          ],
        },
      ],
    ]);
    const meetings = await adapter.listUpcomingMeetings(
      TOKENS,
      new Date("2026-11-30T00:00:00Z"),
    );
    expect(meetings.map((m) => [m.id, m.title, m.meetingUrl])).toEqual([
      ["e1", "Acme discovery", "https://meet.google.com/abc-defg-hij"],
      ["e2", "Zoom in location", "https://acme.zoom.us/j/123456?pwd=x"],
      ["e3", "(no title)", "https://teams.microsoft.com/l/meetup-join/xyz"],
    ]);
    expect(calls[0].url.searchParams.get("timeMin")).toBe(
      "2026-11-30T00:00:00.000Z",
    );
  });
});

describe("GoogleAdapter content", () => {
  it("fetches Gmail messages for a label, preferring plain text", async () => {
    const { adapter, calls } = adapterWith([
      [
        "/messages/m1",
        {
          id: "m1",
          internalDate: "1795000000000",
          payload: {
            headers: [
              { name: "Subject", value: "Kick-off" },
              { name: "From", value: "cto@acme.test" },
            ],
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: b64("Hello Ada ✓") } },
              { mimeType: "text/html", body: { data: b64("<b>Hello</b>") } },
            ],
          },
        },
      ],
      [
        "/messages/m2",
        {
          id: "m2",
          payload: {
            headers: [],
            mimeType: "text/html",
            body: {
              data: b64("<style>p{}</style><p>Only&nbsp;<i>HTML</i></p>"),
            },
          },
        },
      ],
      [
        "/users/me/messages?",
        { messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "next" },
      ],
    ]);
    const page = await adapter.fetchContent(TOKENS, {
      kind: "gmail",
      selector: { labelIds: ["Label_1"] },
    });
    expect(calls[0].url.searchParams.getAll("labelIds")).toEqual(["Label_1"]);
    expect(page.nextPageToken).toBe("next");
    expect(page.items[0]).toMatchObject({
      externalId: "m1",
      title: "Kick-off",
      updatedAt: new Date(1795000000000),
    });
    expect(page.items[0].text).toContain("From: cto@acme.test");
    expect(page.items[0].text).toContain("Hello Ada ✓");
    expect(page.items[0].text).not.toContain("<b>");
    expect(page.items[1].title).toBe("(no subject)");
    expect(page.items[1].text).toContain("Only HTML");
  });

  it("supports a Gmail search query and refuses an empty selector", async () => {
    const { adapter, calls } = adapterWith([["/users/me/messages?", {}]]);
    await adapter.fetchContent(TOKENS, {
      kind: "gmail",
      selector: { query: "from:acme.com" },
    });
    expect(calls[0].url.searchParams.get("q")).toBe("from:acme.com");
    await expect(
      adapter.fetchContent(TOKENS, { kind: "gmail", selector: {} }),
    ).rejects.toThrow(/no label or query/);
  });

  it("reads Docs and text files from a Drive folder, skipping the rest", async () => {
    const { adapter, calls } = adapterWith([
      ["/files/doc1/export", "Exported doc text"],
      ["/files/txt1", "plain file"],
      [
        "/drive/v3/files?",
        {
          files: [
            {
              id: "doc1",
              name: "Proposal",
              mimeType: "application/vnd.google-apps.document",
              modifiedTime: "2026-11-01T00:00:00Z",
              webViewLink: "https://docs.google.com/document/d/doc1",
            },
            { id: "txt1", name: "notes.txt", mimeType: "text/plain" },
            { id: "pdf1", name: "scan.pdf", mimeType: "application/pdf" },
            {
              id: "sub",
              name: "Sub",
              mimeType: "application/vnd.google-apps.folder",
            },
          ],
        },
      ],
    ]);
    const page = await adapter.fetchContent(TOKENS, {
      kind: "google_drive",
      selector: { folderId: "folder-1" },
    });
    expect(calls[0].url.searchParams.get("q")).toBe(
      "'folder-1' in parents and trashed = false",
    );
    expect(page.items.map((item) => [item.externalId, item.text])).toEqual([
      ["doc1", "Exported doc text"],
      ["txt1", "plain file"],
    ]);
    expect(page.items[0].url).toBe("https://docs.google.com/document/d/doc1");
  });

  it("rejects a folder id that could alter the Drive query", async () => {
    const { adapter, calls } = adapterWith([]);
    await expect(
      adapter.fetchContent(TOKENS, {
        kind: "google_drive",
        selector: { folderId: "x' or name contains '" },
      }),
    ).rejects.toThrow(/valid folder/);
    expect(calls).toHaveLength(0);
  });

  it("surfaces API failures with their status", async () => {
    const { adapter } = adapterWith([["/users/me/labels", {}, 401]]);
    const error = await adapter.listSources(TOKENS, "gmail").catch((e) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.status).toBe(401);
  });
});
