import { Marked } from "marked";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const marked = new Marked({
  gfm: true,
  // Raw HTML inside the Markdown is shown as text, never passed through: the
  // content may derive from customer emails and documents.
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      return /^(https?:|mailto:)/i.test(href)
        ? `<a href="${escapeHtml(href)}">${label}</a>`
        : label;
    },
    image({ text }) {
      return escapeHtml(text);
    },
    br() {
      return "<br />";
    },
    hr() {
      return "<hr />";
    },
  },
});

/**
 * Markdown as well-formed XHTML for publishing (Confluence storage format):
 * void elements are self-closed, raw HTML is escaped, and only http(s) and
 * mailto links survive.
 */
export function markdownToXhtml(markdown: string): string {
  return (marked.parse(markdown, { async: false }) as string).trim();
}
