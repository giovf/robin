import { Marked, type Token } from "marked";

/** Headings deeper than this are left out of the outline. */
export const OUTLINE_MAX_DEPTH = 3;

export interface OutlineEntry {
  /** Anchor id of the heading in the rendered document. */
  id: string;
  depth: number;
  text: string;
}

/**
 * Anchor for the n-th outline heading (counting from 0). Positional rather
 * than derived from the text, so the outline and the rendered document agree
 * even when two headings read the same.
 */
export function headingId(index: number): string {
  return `section-${index + 1}`;
}

const lexer = new Marked({ gfm: true });

function plainText(tokens: Token[] | undefined, fallback: string): string {
  if (!tokens?.length) return fallback;
  return tokens
    .map((token) =>
      "tokens" in token && token.tokens?.length
        ? plainText(token.tokens, "")
        : "text" in token && typeof token.text === "string"
          ? token.text
          : "",
    )
    .join("");
}

/** The headings of a Markdown document, in order, down to OUTLINE_MAX_DEPTH. */
export function documentOutline(markdown: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  lexer.walkTokens(lexer.lexer(markdown), (token) => {
    if (token.type !== "heading" || token.depth > OUTLINE_MAX_DEPTH) return;
    entries.push({
      id: headingId(entries.length),
      depth: token.depth,
      text: plainText(token.tokens, token.text).trim() || "Untitled section",
    });
  });
  return entries;
}

/** A file name for downloading a document: lowercase words joined by dashes. */
export function documentFileName(title: string, extension: string): string {
  const stem =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "document";
  return `${stem}.${extension}`;
}
