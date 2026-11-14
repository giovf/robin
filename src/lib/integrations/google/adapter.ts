import { IntegrationError } from "../errors";
import type {
  ConnectedAccount,
  ContentItem,
  CustomerSourceKind,
  FetchedContent,
  IntegrationAdapter,
  IntegrationSource,
  OAuthTokens,
} from "../types";

/*
 * Google (Gmail, Drive, Calendar) over plain REST + fetch — read-only.
 * No SDK: the surface used is small, and fetch is trivial to fake in tests.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE = "https://www.googleapis.com/drive/v3";
const CALENDAR = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Google-native files and the plain-text format each is exported as. */
const EXPORT_AS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};
const GMAIL_PAGE_SIZE = 25;
const DRIVE_PAGE_SIZE = 25;
const MAX_FOLDERS = 500;

/** Gmail: labels and/or a Gmail search query (addresses, domains…). */
export interface GmailSelector {
  labelIds?: string[];
  query?: string;
}
export interface DriveSelector {
  folderId: string;
}

export interface GoogleAdapterConfig {
  clientId: string;
  clientSecret: string;
}

/** An upcoming calendar event that has a meeting link. */
export interface UpcomingMeeting {
  id: string;
  title: string;
  start: Date;
  meetingUrl: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: { name: string; value: string }[] };
}
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
}
interface CalendarEvent {
  id: string;
  summary?: string;
  location?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findPart(part: GmailPart, mimeType: string): string | undefined {
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The readable text of a Gmail message: plain text, else de-tagged HTML. */
export function gmailMessageText(message: GmailMessage): string {
  if (!message.payload) return "";
  const plain = findPart(message.payload, "text/plain");
  if (plain !== undefined) return plain.trim();
  const html = findPart(message.payload, "text/html");
  return html === undefined ? "" : stripHtml(html);
}

const MEETING_URL =
  /https:\/\/(?:[\w-]+\.)?(?:zoom\.us\/j\/|meet\.google\.com\/|teams\.microsoft\.com\/l\/meetup-join\/|teams\.live\.com\/meet\/)[^\s<>"]+/;

function meetingUrlOf(event: CalendarEvent): string | undefined {
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video" && entry.uri,
  );
  return (
    video?.uri ?? event.hangoutLink ?? event.location?.match(MEETING_URL)?.[0]
  );
}

export class GoogleAdapter implements IntegrationAdapter {
  readonly provider = "google" as const;
  readonly sourceKinds = ["gmail", "google_drive"] as const;
  readonly defaultScopes = GOOGLE_SCOPES;

  constructor(
    private readonly config: GoogleAdapterConfig,
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
      client_id: this.config.clientId,
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: (input.scopes ?? this.defaultScopes).join(" "),
      state: input.state,
      // "offline" + "consent" make Google issue a refresh token every time.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
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

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    return this.token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  async getAccount(tokens: OAuthTokens): Promise<ConnectedAccount> {
    const info = await this.get<{ sub: string; email?: string }>(
      tokens,
      USERINFO_URL,
    );
    return { externalAccountId: info.sub, label: info.email ?? info.sub };
  }

  // ── Source discovery ─────────────────────────────────────────────────────

  async listSources(
    tokens: OAuthTokens,
    kind: CustomerSourceKind,
  ): Promise<IntegrationSource[]> {
    if (kind === "gmail") {
      const data = await this.get<{
        labels?: { id: string; name: string }[];
      }>(tokens, `${GMAIL}/labels`);
      return (data.labels ?? [])
        .map((label) => ({
          kind,
          id: label.id,
          name: label.name,
          selector: { labelIds: [label.id] } satisfies GmailSelector,
        }))
        .sort((x, y) => x.name.localeCompare(y.name));
    }
    if (kind === "google_drive") {
      const folders: IntegrationSource[] = [];
      let pageToken: string | undefined;
      do {
        const data = await this.get<{
          files?: { id: string; name: string }[];
          nextPageToken?: string;
        }>(tokens, `${DRIVE}/files`, {
          q: `mimeType = '${FOLDER_MIME}' and trashed = false`,
          fields: "nextPageToken, files(id, name)",
          orderBy: "name",
          pageSize: "100",
          ...(pageToken ? { pageToken } : {}),
        });
        for (const file of data.files ?? []) {
          folders.push({
            kind,
            id: file.id,
            name: file.name,
            selector: { folderId: file.id } satisfies DriveSelector,
          });
        }
        pageToken = data.nextPageToken;
      } while (pageToken && folders.length < MAX_FOLDERS);
      return folders;
    }
    return [];
  }

  /** Upcoming events on the primary calendar that carry a meeting link. */
  async listUpcomingMeetings(
    tokens: OAuthTokens,
    now: Date = new Date(),
  ): Promise<UpcomingMeeting[]> {
    const data = await this.get<{ items?: CalendarEvent[] }>(
      tokens,
      `${CALENDAR}/calendars/primary/events`,
      {
        timeMin: now.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "25",
        conferenceDataVersion: "1",
      },
    );
    const meetings: UpcomingMeeting[] = [];
    for (const event of data.items ?? []) {
      const meetingUrl = meetingUrlOf(event);
      const start = event.start?.dateTime ?? event.start?.date;
      if (!meetingUrl || !start) continue;
      meetings.push({
        id: event.id,
        title: event.summary ?? "(no title)",
        start: new Date(start),
        meetingUrl,
      });
    }
    return meetings;
  }

  // ── Content ──────────────────────────────────────────────────────────────

  async fetchContent(
    tokens: OAuthTokens,
    source: Pick<IntegrationSource, "kind" | "selector">,
    pageToken?: string,
  ): Promise<FetchedContent> {
    const { selector } = source;
    if (source.kind === "gmail") {
      const labelIds = Array.isArray(selector.labelIds)
        ? selector.labelIds.filter((id) => typeof id === "string")
        : undefined;
      const query =
        typeof selector.query === "string" ? selector.query : undefined;
      return this.fetchGmail(tokens, { labelIds, query }, pageToken);
    }
    if (source.kind === "google_drive") {
      const folderId =
        typeof selector.folderId === "string" ? selector.folderId : "";
      return this.fetchDrive(tokens, { folderId }, pageToken);
    }
    throw new IntegrationError(`Google cannot supply "${source.kind}".`);
  }

  private async fetchGmail(
    tokens: OAuthTokens,
    selector: GmailSelector,
    pageToken?: string,
  ): Promise<FetchedContent> {
    if (!selector.labelIds?.length && !selector.query) {
      // Never fall back to "the whole mailbox".
      throw new IntegrationError("Gmail source has no label or query.");
    }
    const params = new URLSearchParams({ maxResults: String(GMAIL_PAGE_SIZE) });
    for (const id of selector.labelIds ?? []) params.append("labelIds", id);
    if (selector.query) params.set("q", selector.query);
    if (pageToken) params.set("pageToken", pageToken);

    const list = await this.get<{
      messages?: { id: string }[];
      nextPageToken?: string;
    }>(tokens, `${GMAIL}/messages?${params}`);

    const items: ContentItem[] = [];
    for (const { id } of list.messages ?? []) {
      const message = await this.get<GmailMessage>(
        tokens,
        `${GMAIL}/messages/${encodeURIComponent(id)}`,
        { format: "full" },
      );
      const header = (name: string): string =>
        message.payload?.headers?.find(
          (h) => h.name.toLowerCase() === name.toLowerCase(),
        )?.value ?? "";
      const subject = header("Subject") || "(no subject)";
      items.push({
        externalId: message.id,
        title: subject,
        url: `https://mail.google.com/mail/u/0/#all/${message.id}`,
        text: [
          `From: ${header("From")}`,
          `To: ${header("To")}`,
          `Date: ${header("Date")}`,
          `Subject: ${subject}`,
          "",
          gmailMessageText(message),
        ].join("\n"),
        updatedAt: message.internalDate
          ? new Date(Number(message.internalDate))
          : undefined,
      });
    }
    return { items, nextPageToken: list.nextPageToken };
  }

  private async fetchDrive(
    tokens: OAuthTokens,
    selector: DriveSelector,
    pageToken?: string,
  ): Promise<FetchedContent> {
    if (!/^[\w-]+$/.test(selector.folderId ?? "")) {
      throw new IntegrationError("Drive source has no valid folder.");
    }
    const list = await this.get<{
      files?: DriveFile[];
      nextPageToken?: string;
    }>(tokens, `${DRIVE}/files`, {
      q: `'${selector.folderId}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)",
      pageSize: String(DRIVE_PAGE_SIZE),
      ...(pageToken ? { pageToken } : {}),
    });

    const items: ContentItem[] = [];
    for (const file of list.files ?? []) {
      const base = `${DRIVE}/files/${encodeURIComponent(file.id)}`;
      let text: string;
      if (EXPORT_AS[file.mimeType]) {
        text = await this.getText(tokens, `${base}/export`, {
          mimeType: EXPORT_AS[file.mimeType],
        });
      } else if (
        file.mimeType.startsWith("text/") ||
        file.mimeType === "application/json"
      ) {
        text = await this.getText(tokens, base, { alt: "media" });
      } else {
        // Sub-folders and binary formats (PDF, Office…) are not read here.
        continue;
      }
      items.push({
        externalId: file.id,
        title: file.name,
        url: file.webViewLink,
        text,
        updatedAt: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
      });
    }
    return { items, nextPageToken: list.nextPageToken };
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  private async token(params: Record<string, string>): Promise<OAuthTokens> {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...params,
      }),
    });
    if (!response.ok) {
      // The body can echo secrets back; keep only the status.
      throw new IntegrationError(
        `Google token request failed (${response.status}).`,
        response.status,
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

  private async request(
    tokens: OAuthTokens,
    url: string,
    query?: Record<string, string>,
  ): Promise<Response> {
    const target = new URL(url);
    for (const [name, value] of Object.entries(query ?? {})) {
      target.searchParams.set(name, value);
    }
    const response = await this.fetchImpl(target, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!response.ok) {
      throw new IntegrationError(
        `Google API request failed (${response.status}) for ${target.origin}${target.pathname}.`,
        response.status,
      );
    }
    return response;
  }

  private async get<T>(
    tokens: OAuthTokens,
    url: string,
    query?: Record<string, string>,
  ): Promise<T> {
    return (await (await this.request(tokens, url, query)).json()) as T;
  }

  private async getText(
    tokens: OAuthTokens,
    url: string,
    query?: Record<string, string>,
  ): Promise<string> {
    return (await this.request(tokens, url, query)).text();
  }
}
