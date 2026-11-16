import type { OutlineEntry } from "@/lib/documents/outline";

interface DocumentOutlineProps {
  entries: OutlineEntry[];
  /** Prefix for the anchor links, e.g. the document's URL. Default: this page. */
  hrefBase?: string;
}

/** A document's table of contents: its headings as links to their anchors. */
export function DocumentOutline({
  entries,
  hrefBase = "",
}: DocumentOutlineProps) {
  if (!entries.length) return null;
  const top = Math.min(...entries.map((entry) => entry.depth));
  return (
    <nav aria-label="In this document" className="text-sm">
      <h4 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
        In this document
      </h4>
      <ul className="border-line flex flex-col border-l">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`${hrefBase}#${entry.id}`}
              className="text-muted hover:text-ink hover:border-accent -ml-px block border-l border-transparent py-1 pr-2 leading-snug"
              style={{ paddingLeft: `${0.75 + (entry.depth - top) * 0.75}rem` }}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
