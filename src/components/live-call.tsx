"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LiveCallState } from "@/lib/calls/calls";

import { cardClass, dangerButtonClass, secondaryButtonClass } from "./ui";

type Segment = LiveCallState["segments"][number];
type SuggestionItem = LiveCallState["suggestions"][number];
type SuggestionStateValue = SuggestionItem["state"];

const POLL_MS = 2500;
/** Ask the provider for the bot's status on every Nth poll. */
const REFRESH_EVERY = 4;

const STATUS_TEXT: Record<string, string> = {
  creating: "Starting the bot…",
  joining:
    "Robin is joining the meeting — admit it if there is a waiting room.",
  in_call: "Live — Robin is in the call.",
  leaving: "Robin is leaving the call…",
  left: "Call ended.",
  error: "The bot could not join or was removed.",
};

interface LiveCallProps {
  customerId: string;
  initial: LiveCallState;
  endCall: () => Promise<void>;
  setSuggestionState: (
    suggestionId: string,
    state: SuggestionStateValue,
  ) => Promise<void>;
}

/** The live call screen: transcript on one side, suggested questions on the other. */
export function LiveCall({
  customerId,
  initial,
  endCall,
  setSuggestionState,
}: LiveCallProps) {
  const router = useRouter();
  const [call, setCall] = useState(initial.call);
  const [active, setActive] = useState(initial.active);
  const [segments, setSegments] = useState<Segment[]>(initial.segments);
  const [suggestions, setSuggestions] = useState(initial.suggestions);
  const [ending, setEnding] = useState(false);
  const [offline, setOffline] = useState(false);
  const cursor = useRef(initial.cursor);
  const polls = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const poll = useCallback(async (): Promise<void> => {
    polls.current += 1;
    const query = new URLSearchParams();
    if (cursor.current) query.set("after", cursor.current);
    if (polls.current % REFRESH_EVERY === 0) query.set("refresh", "1");
    try {
      const response = await fetch(
        `/api/customers/${customerId}/calls/${initial.call.id}/live?${query}`,
      );
      if (!response.ok) throw new Error(String(response.status));
      const state: LiveCallState = await response.json();
      cursor.current = state.cursor;
      setOffline(false);
      setCall(state.call);
      setActive(state.active);
      setSuggestions(state.suggestions);
      if (state.segments.length) {
        setSegments((current) => {
          const known = new Set(current.map((segment) => segment.id));
          return [
            ...current,
            ...state.segments.filter((segment) => !known.has(segment.id)),
          ];
        });
      }
    } catch {
      setOffline(true);
    }
  }, [customerId, initial.call.id]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, poll]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "nearest" });
  }, [segments.length]);

  async function onEnd(): Promise<void> {
    setEnding(true);
    await endCall();
    await poll();
    setEnding(false);
    router.refresh();
  }

  async function mark(id: string, state: SuggestionStateValue): Promise<void> {
    setSuggestions((current) =>
      current.map((item) => (item.id === id ? { ...item, state } : item)),
    );
    await setSuggestionState(id, state);
  }

  const open = suggestions.filter((item) => item.state === "shown");
  const handled = suggestions.filter((item) => item.state !== "shown");
  const status = call.botStatus ?? "creating";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          role="status"
          className={`rounded-control px-3 py-2 text-sm ${
            status === "error"
              ? "bg-danger-soft text-danger"
              : status === "in_call"
                ? "bg-success-soft text-success"
                : "bg-sunken text-ink"
          }`}
        >
          {STATUS_TEXT[status]}
          {status === "error" && call.botStatusDetail
            ? ` (${call.botStatusDetail.replaceAll("_", " ")})`
            : ""}
          {offline ? " Connection lost — retrying…" : ""}
        </p>
        {active ? (
          <button
            type="button"
            onClick={() => void onEnd()}
            disabled={ending}
            className={dangerButtonClass}
          >
            {ending ? "Ending…" : "End call"}
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="transcript-heading"
          className={`${cardClass} flex max-h-[32rem] flex-col`}
        >
          <h4
            id="transcript-heading"
            className="border-line border-b px-4 py-3 text-sm font-semibold"
          >
            Transcript
          </h4>
          <div
            role="log"
            aria-label="Transcript"
            tabIndex={0}
            className="flex-1 overflow-y-auto px-4 py-3 text-sm"
          >
            {segments.length ? (
              <ul className="flex flex-col gap-2">
                {segments.map((segment) => (
                  <li key={segment.id}>
                    <span className="font-medium">{segment.speaker}:</span>{" "}
                    {segment.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">
                {active
                  ? "Waiting for someone to speak. With caption-based transcription, captions must be turned on in the meeting."
                  : "No transcript was captured."}
              </p>
            )}
            <div ref={transcriptEnd} />
          </div>
        </section>

        <section
          aria-labelledby="suggestions-heading"
          className={`${cardClass} flex max-h-[32rem] flex-col`}
        >
          <h4
            id="suggestions-heading"
            className="border-line border-b px-4 py-3 text-sm font-semibold"
          >
            Suggested questions
          </h4>
          <div
            aria-live="polite"
            className="flex-1 overflow-y-auto px-4 py-3 text-sm"
          >
            {open.length ? (
              <ul className="flex flex-col gap-3">
                {open.map((item) => (
                  <li
                    key={item.id}
                    className="border-accent/40 bg-accent-soft rounded-control border p-3"
                  >
                    <p className="font-medium">{item.text}</p>
                    {item.rationale ? (
                      <p className="text-muted mt-1 text-xs">
                        {item.rationale}
                      </p>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void mark(item.id, "asked")}
                        className={`${secondaryButtonClass} px-3 py-1 text-xs`}
                      >
                        Asked
                        <span className="sr-only">: {item.text}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void mark(item.id, "dismissed")}
                        className={`${secondaryButtonClass} px-3 py-1 text-xs`}
                      >
                        Dismiss
                        <span className="sr-only">: {item.text}</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">
                {active
                  ? "Suggestions appear here as the conversation develops."
                  : "No open suggestions."}
              </p>
            )}
            {handled.length ? (
              <details className="mt-4">
                <summary className="text-muted cursor-pointer text-xs">
                  Asked or dismissed ({handled.length})
                </summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {handled.map((item) => (
                    <li key={item.id} className="text-muted">
                      <span className="text-xs font-semibold uppercase">
                        {item.state}
                      </span>{" "}
                      {item.text}{" "}
                      <button
                        type="button"
                        onClick={() => void mark(item.id, "shown")}
                        className="text-xs underline"
                      >
                        Restore
                        <span className="sr-only">: {item.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
