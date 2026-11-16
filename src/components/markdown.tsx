import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders Markdown as formatted text. Raw HTML in the source is not rendered
 * (react-markdown's default), which matters because the text can derive from
 * customer emails and documents.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
