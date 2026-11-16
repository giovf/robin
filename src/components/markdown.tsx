import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { headingId, OUTLINE_MAX_DEPTH } from "@/lib/documents/outline";

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * Gives every outline-level heading the positional anchor that
 * `documentOutline` produces for it, so a table of contents can link to it.
 */
function rehypeHeadingIds(): (tree: HastNode) => void {
  return (tree) => {
    let index = 0;
    const visit = (node: HastNode): void => {
      const depth = /^h([1-6])$/.exec(node.tagName ?? "")?.[1];
      if (node.type === "element" && depth) {
        if (Number(depth) <= OUTLINE_MAX_DEPTH) {
          node.properties = { ...node.properties, id: headingId(index++) };
        }
        return;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

interface MarkdownProps {
  children: string;
  /** Add anchors to headings (for a page that shows the document's outline). */
  headingIds?: boolean;
}

/**
 * Renders Markdown as formatted text. Raw HTML in the source is not rendered
 * (react-markdown's default), which matters because the text can derive from
 * customer emails and documents.
 */
export function Markdown({ children, headingIds = false }: MarkdownProps) {
  return (
    <div className="markdown text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={headingIds ? [rehypeHeadingIds] : []}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
