"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import type { FormState } from "@/lib/form-action";

import {
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

interface DiagramEditorProps {
  title: string;
  sourceCode: string;
  titleMaxLength: number;
  save: (state: FormState, formData: FormData) => Promise<FormState>;
}

function download(url: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
}

function fileStem(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "diagram"
  );
}

/** Mermaid source with a live rendered preview and SVG/PNG export. */
export function DiagramEditor({
  title,
  sourceCode,
  titleMaxLength,
  save,
}: DiagramEditorProps) {
  const [state, formAction, pending] = useActionState(save, {});
  const [name, setName] = useState(title);
  const [source, setSource] = useState(sourceCode);
  const [svg, setSvg] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
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
        const result = await mermaid.render(`m${renderId}${run}`, source);
        if (run === sequence.current) {
          setSvg(result.svg);
          setProblem(null);
        }
      } catch (error) {
        if (run === sequence.current) {
          setProblem(
            error instanceof Error
              ? error.message.split("\n").slice(0, 4).join("\n")
              : "The diagram source is not valid Mermaid.",
          );
        }
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [source, renderId]);

  function exportSvg(): void {
    const url = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    download(url, `${fileStem(name)}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPng(): void {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = parsed.documentElement;
    const [, , boxWidth, boxHeight] = (root.getAttribute("viewBox") ?? "")
      .split(/[\s,]+/)
      .map(Number);
    const width = boxWidth || 1200;
    const height = boxHeight || 800;
    root.setAttribute("width", String(width));
    root.setAttribute("height", String(height));
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      download(canvas.toDataURL("image/png"), `${fileStem(name)}.png`);
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      new XMLSerializer().serializeToString(root),
    )}`;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className={labelClass}>
          Title
        </label>
        <input
          id="title"
          name="title"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={titleMaxLength}
          className={`${inputClass} max-w-xl`}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sourceCode" className={labelClass}>
            Mermaid source
          </label>
          <textarea
            id="sourceCode"
            name="sourceCode"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            required
            spellCheck={false}
            aria-describedby={problem ? "diagram-problem" : undefined}
            className={`${inputClass} min-h-[24rem] font-mono text-xs leading-relaxed`}
          />
          {problem ? (
            <pre
              id="diagram-problem"
              role="alert"
              className="bg-danger-soft text-danger rounded-control overflow-x-auto px-3 py-2 text-xs whitespace-pre-wrap"
            >
              {problem}
            </pre>
          ) : null}
        </div>
        <section
          aria-label="Diagram preview"
          className={`${cardClass} flex min-h-[24rem] items-center justify-center overflow-auto bg-white p-4`}
        >
          {svg ? (
            <div
              role="img"
              aria-label={`Diagram: ${name}`}
              className={`w-full ${problem ? "opacity-40" : ""}`}
              // Rendered by Mermaid at securityLevel "strict" (sanitised).
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <p className="text-sm text-neutral-600">
              {problem ? "Fix the source to see the diagram." : "Rendering…"}
            </p>
          )}
        </section>
      </div>
      {state.error ? (
        <p
          role="alert"
          className="bg-danger-soft text-danger rounded-control px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={exportSvg}
          disabled={!svg || Boolean(problem)}
          className={secondaryButtonClass}
        >
          Download SVG
        </button>
        <button
          type="button"
          onClick={exportPng}
          disabled={!svg || Boolean(problem)}
          className={secondaryButtonClass}
        >
          Download PNG
        </button>
        <p role="status" className="text-success text-sm">
          {!pending && !state.error ? state.message : null}
        </p>
      </div>
    </form>
  );
}
