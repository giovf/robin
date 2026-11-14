"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { primaryButtonClass } from "./ui";

interface UploadOutcome {
  name: string;
  ok: boolean;
  detail: string;
}

interface UploadFormProps {
  customerId: string;
  /** e.g. ".pdf,.docx,.txt" */
  accept: string;
  maxMegabytes: number;
}

/** Uploads one or more files to a customer's context, one request per file. */
export function UploadForm({
  customerId,
  accept,
  maxMegabytes,
}: UploadFormProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);

  async function upload(file: File): Promise<UploadOutcome> {
    if (file.size > maxMegabytes * 1024 * 1024) {
      return {
        name: file.name,
        ok: false,
        detail: `Larger than ${maxMegabytes} MB.`,
      };
    }
    const body = new FormData();
    body.set("file", file);
    try {
      const response = await fetch(`/api/customers/${customerId}/upload`, {
        method: "POST",
        body,
      });
      const data: { error?: string; chunkCount?: number; changed?: boolean } =
        await response.json();
      if (!response.ok) {
        return {
          name: file.name,
          ok: false,
          detail: data.error ?? "Upload failed.",
        };
      }
      return {
        name: file.name,
        ok: true,
        detail: data.changed
          ? `Added (${data.chunkCount} ${data.chunkCount === 1 ? "chunk" : "chunks"}).`
          : "Already in the context — unchanged.",
      };
    } catch {
      return { name: file.name, ok: false, detail: "Upload failed." };
    }
  }

  async function onSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const files = [...(input.current?.files ?? [])];
    if (!files.length) return;
    setBusy(true);
    setOutcomes([]);
    const results: UploadOutcome[] = [];
    for (const file of files) {
      results.push(await upload(file));
      setOutcomes([...results]);
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="upload-files" className="text-ink text-sm font-medium">
          Files
        </label>
        <input
          ref={input}
          id="upload-files"
          name="file"
          type="file"
          multiple
          required
          accept={accept}
          aria-describedby="upload-hint"
          className="border-line bg-surface text-ink file:bg-sunken file:text-ink rounded-control w-full border border-dashed p-4 text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <p id="upload-hint" className="text-muted text-xs">
          Choose files or drop them on the field. {accept.replaceAll(",", ", ")}{" "}
          — up to {maxMegabytes} MB each.
        </p>
      </div>
      <div>
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      <ul aria-live="polite" className="flex flex-col gap-1 text-sm">
        {outcomes.map((outcome, index) => (
          <li
            key={`${outcome.name}-${index}`}
            className={outcome.ok ? "text-success" : "text-danger"}
          >
            <span className="font-medium">{outcome.name}:</span>{" "}
            {outcome.detail}
          </li>
        ))}
      </ul>
    </form>
  );
}
