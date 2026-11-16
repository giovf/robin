import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { cardClass, linkClass } from "@/components/ui";
import {
  CALL_TITLE_MAX_LENGTH,
  isCallActive,
  listCalls,
} from "@/lib/calls/calls";
import { formatDate, orNotFound, requireSolution } from "@/lib/hub";
import {
  getFreshIntegrationTokens,
  IntegrationError,
  listIntegrationConnections,
  resolveAdapter,
} from "@/lib/integrations";
import {
  GoogleAdapter,
  type UpcomingMeeting,
} from "@/lib/integrations/google/adapter";

import { startCallAction } from "./actions";

export const metadata: Metadata = { title: "Calls" };

const STATUS_LABELS: Record<string, string> = {
  creating: "Starting",
  joining: "Joining",
  in_call: "Live",
  leaving: "Ending",
  left: "Ended",
  error: "Failed",
};

/** Upcoming calendar events with a meeting link, from connected Google accounts. */
async function UpcomingMeetings({
  organizationId,
  base,
}: {
  organizationId: string;
  base: string;
}) {
  const adapter = resolveAdapter("google");
  if (!(adapter instanceof GoogleAdapter)) return null;
  const connections = (await listIntegrationConnections(organizationId)).filter(
    (connection) =>
      connection.provider === "google" && connection.status === "active",
  );
  const meetings: UpcomingMeeting[] = [];
  for (const connection of connections) {
    try {
      const fresh = await getFreshIntegrationTokens(
        organizationId,
        connection.id,
      );
      if (fresh)
        meetings.push(...(await adapter.listUpcomingMeetings(fresh.tokens)));
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
    }
  }
  if (!meetings.length) return null;
  meetings.sort((x, y) => x.start.getTime() - y.start.getTime());
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">From your calendar</h4>
      <ul className="flex flex-col gap-1 text-sm">
        {meetings.slice(0, 8).map((meeting) => (
          <li key={meeting.id}>
            <Link
              href={`${base}?${new URLSearchParams({ meetingUrl: meeting.meetingUrl, title: meeting.title })}`}
              className={linkClass}
            >
              {meeting.title}
            </Link>{" "}
            <span className="text-muted">
              ·{" "}
              {meeting.start.toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted text-xs">
        Choosing one fills in the form below; nothing is sent yet.
      </p>
    </div>
  );
}

export default async function SolutionCallsPage({
  params,
  searchParams,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/calls">) {
  const { customerId, solutionId } = await params;
  const { user, solution } = await requireSolution(customerId, solutionId);
  const query = await searchParams;
  const prefill = (name: string): string =>
    typeof query[name] === "string" ? query[name].slice(0, 2000) : "";
  const base = `/customers/${customerId}/solutions/${solution.id}/calls`;
  const calls = await orNotFound(() =>
    listCalls(user.id, customerId, solution.id),
  );

  return (
    <>
      <PageHeader
        as="h3"
        title="Calls"
        description="Robin joins the meeting as a visible participant, transcribes it and suggests questions while you talk."
      />

      <section
        aria-labelledby="start-heading"
        className={`${cardClass} flex max-w-2xl flex-col gap-5 p-6`}
      >
        <h4 id="start-heading" className="text-base font-semibold">
          Start a call
        </h4>
        <Suspense fallback={null}>
          <UpcomingMeetings organizationId={user.organizationId} base={base} />
        </Suspense>
        <ActionForm
          key={`${prefill("meetingUrl")}|${prefill("title")}`}
          action={startCallAction.bind(null, customerId, solution.id)}
          submitLabel="Send Robin to the meeting"
        >
          <TextField
            name="meetingUrl"
            label="Meeting link"
            hint="A Zoom, Google Meet or Microsoft Teams link."
            defaultValue={prefill("meetingUrl")}
            required
          />
          <TextField
            name="title"
            label="Title"
            hint="Optional."
            defaultValue={prefill("title")}
            maxLength={CALL_TITLE_MAX_LENGTH}
          />
          <div className="border-line bg-sunken rounded-control flex flex-col gap-3 border p-4 text-sm">
            <p>
              <strong>Recording consent.</strong> Robin will join as a
              participant named “Robin (notetaker)” and transcribe what is said.
              Tell everyone in the meeting, and make sure they agree, before it
              joins. Rules differ by country; when in doubt, ask out loud at the
              start of the call.
            </p>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                name="consent"
                value="yes"
                required
                className="mt-0.5 size-4"
              />
              <span>
                The participants know about the recording and have agreed to it.
              </span>
            </label>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="past-heading" className="flex flex-col gap-3">
        <h4 id="past-heading" className="text-base font-semibold">
          Calls ({calls.length})
        </h4>
        {calls.length ? (
          <ul className={`${cardClass} divide-line divide-y overflow-hidden`}>
            {calls.map((call) => (
              <li key={call.id}>
                <Link
                  href={`${base}/${call.id}`}
                  className="hover:bg-sunken flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="font-medium">
                    {call.title ?? "Untitled call"}
                  </span>
                  <span className="text-muted">
                    {formatDate(call.createdAt)} ·{" "}
                    <span className={isCallActive(call) ? "text-success" : ""}>
                      {STATUS_LABELS[call.botStatus ?? "creating"]}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`${cardClass} text-muted p-6 text-sm`}>No calls yet.</p>
        )}
      </section>
    </>
  );
}
