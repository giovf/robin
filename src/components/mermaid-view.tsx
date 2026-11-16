"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface MermaidResult {
  /** The rendered diagram, or "" before the first successful render. */
  svg: string;
  /** Why the current source could not be rendered, if it could not. */
  problem: string | null;
}

/**
 * Renders Mermaid source to SVG in the browser, re-rendering `delay` ms after
 * the source last changed. The last good SVG is kept while the source is
 * invalid.
 */
export function useMermaid(source: string, delay = 0): MermaidResult {
  const [result, setResult] = useState<MermaidResult>({
    svg: "",
    problem: null,
  });
  const renderId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const sequence = useRef(0);

  useEffect(() => {
    const run = ++sequence.current;
    const timer = setTimeout(async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          // "strict" sanitises labels and disables click handlers.
          securityLevel: "strict",
          theme: window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "neutral",
        });
        await mermaid.parse(source);
        const rendered = await mermaid.render(`m${renderId}${run}`, source);
        if (run === sequence.current) {
          setResult({ svg: rendered.svg, problem: null });
        }
      } catch (error) {
        if (run === sequence.current) {
          setResult((previous) => ({
            svg: previous.svg,
            problem:
              error instanceof Error
                ? error.message.split("\n").slice(0, 4).join("\n")
                : "The diagram source is not valid Mermaid.",
          }));
        }
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [source, renderId, delay]);

  return result;
}

interface MermaidViewProps {
  source: string;
  /** Accessible name of the diagram. */
  label: string;
}

/** A read-only rendered Mermaid diagram. */
export function MermaidView({ source, label }: MermaidViewProps) {
  const { svg, problem } = useMermaid(source);
  if (svg && !problem) {
    return (
      <div
        role="img"
        aria-label={label}
        className="w-full"
        // Rendered by Mermaid at securityLevel "strict" (sanitised).
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  return (
    <p className="text-sm text-neutral-600">
      {problem ? "This diagram's source is not valid Mermaid." : "Rendering…"}
    </p>
  );
}
