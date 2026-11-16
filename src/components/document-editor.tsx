"use client";

import { useActionState, useState } from "react";

import type { FormState } from "@/lib/form-action";

import { Markdown } from "./markdown";
import {
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

interface DocumentEditorProps {
  title: string;
  content: string;
  titleMaxLength: number;
  save: (state: FormState, formData: FormData) => Promise<FormState>;
}

/** Markdown source on one side, formatted preview on the other. */
export function DocumentEditor({
  title,
  content,
  titleMaxLength,
  save,
}: DocumentEditorProps) {
  const [state, formAction, pending] = useActionState(save, {});
  const [text, setText] = useState(content);
  const [view, setView] = useState<"both" | "edit" | "preview">("both");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className={labelClass}>
          Title
        </label>
        <input
          id="title"
          name="title"
          defaultValue={title}
          required
          maxLength={titleMaxLength}
          className={`${inputClass} max-w-xl`}
        />
      </div>

      <div role="group" aria-label="Editor layout" className="flex gap-2">
        {(["both", "edit", "preview"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={view === option}
            onClick={() => setView(option)}
            className={`${secondaryButtonClass} px-3 py-1 text-xs ${
              view === option ? "border-accent text-accent" : ""
            }`}
          >
            {option === "both"
              ? "Side by side"
              : option === "edit"
                ? "Markdown"
                : "Preview"}
          </button>
        ))}
      </div>

      <div className={`grid gap-4 ${view === "both" ? "lg:grid-cols-2" : ""}`}>
        <div
          className={view === "preview" ? "hidden" : "flex flex-col gap-1.5"}
        >
          <label htmlFor="content" className={labelClass}>
            Markdown
          </label>
          <textarea
            id="content"
            name="content"
            value={text}
            onChange={(event) => setText(event.target.value)}
            required
            spellCheck
            className={`${inputClass} min-h-[32rem] font-mono text-xs leading-relaxed`}
          />
        </div>
        {view === "edit" ? null : (
          <section
            aria-label="Preview"
            className={`${cardClass} max-h-[40rem] overflow-y-auto p-6`}
          >
            <Markdown>{text}</Markdown>
          </section>
        )}
      </div>

      {state.error ? (
        <p
          role="alert"
          className="bg-danger-soft text-danger rounded-control px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving…" : "Save as new version"}
        </button>
        <p role="status" className="text-success text-sm">
          {!pending && !state.error ? state.message : null}
        </p>
      </div>
    </form>
  );
}
