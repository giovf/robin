"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Markdown } from "./markdown";
import { cardClass, primaryButtonClass, secondaryButtonClass } from "./ui";

const RESULT_MARKER = "\u001e";

interface TemplateOption {
  id: string;
  name: string;
  summary: string;
  phaseLabel: string;
  /** Belongs to the solution's current phase. */
  current: boolean;
}

interface GenerateDocumentProps {
  customerId: string;
  solutionId: string;
  templates: TemplateOption[];
  /** Template to preselect (from the link the user followed). */
  initialTemplateId?: string;
}

/** Template picker that streams the agent's draft while it is written. */
export function GenerateDocument({
  customerId,
  solutionId,
  templates,
  initialTemplateId,
}: GenerateDocumentProps) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(
    templates.some((template) => template.id === initialTemplateId)
      ? initialTemplateId
      : (templates.find((template) => template.current)?.id ??
          templates[0]?.id),
  );
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const base = `/customers/${customerId}/solutions/${solutionId}/documents`;

  async function onSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDraft("");
    try {
      const response = await fetch(
        `/api/customers/${customerId}/solutions/${solutionId}/documents/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId }),
        },
      );
      if (!response.ok || !response.body) throw new Error("Request failed.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
        setDraft(received.split(RESULT_MARKER)[0]);
      }
      const result: { documentId?: string; error?: string } = JSON.parse(
        received.split(RESULT_MARKER)[1] ?? "{}",
      );
      if (result.documentId) {
        router.push(`${base}/${result.documentId}`);
        return;
      }
      setError(result.error ?? "Drafting did not finish. Try again.");
    } catch {
      setError("Drafting did not finish. Try again.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4">
        <fieldset disabled={busy} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">Template</legend>
          {templates.map((template) => (
            <label
              key={template.id}
              className={`${cardClass} has-checked:border-accent flex cursor-pointer items-start gap-3 p-3 text-sm`}
            >
              <input
                type="radio"
                name="templateId"
                value={template.id}
                checked={templateId === template.id}
                onChange={() => setTemplateId(template.id)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{template.name}</span>{" "}
                <span className="text-muted">
                  · {template.phaseLabel}
                  {template.current ? " (current phase)" : ""}
                </span>
                <span className="text-muted block">{template.summary}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error ? (
          <p
            role="alert"
            className="bg-danger-soft text-danger rounded-control px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {busy ? "Drafting…" : "Draft with Robin"}
          </button>
          <button
            type="button"
            onClick={() => router.push(base)}
            disabled={busy}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
        </div>
        <p className="text-muted text-xs">
          Robin drafts from this customer&apos;s context only. It usually takes
          under a minute; you review and edit the result before anyone else sees
          it.
        </p>
      </form>
      {draft ? (
        <section
          aria-label="Draft in progress"
          aria-busy={busy}
          className={`${cardClass} p-6`}
        >
          <Markdown>{draft}</Markdown>
        </section>
      ) : null}
    </div>
  );
}
