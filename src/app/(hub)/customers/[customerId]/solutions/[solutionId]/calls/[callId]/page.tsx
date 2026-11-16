import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LiveCall } from "@/components/live-call";
import { PageHeader } from "@/components/page-header";
import { getLiveCallState } from "@/lib/calls/calls";
import { formatDate, orNotFound, requireSolution } from "@/lib/hub";

import { endCallAction, setSuggestionStateAction } from "../actions";

export const metadata: Metadata = { title: "Call" };

export default async function CallPage({
  params,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/calls/[callId]">) {
  const { customerId, solutionId, callId } = await params;
  const { user } = await requireSolution(customerId, solutionId);
  const state = await orNotFound(() =>
    getLiveCallState(user.id, customerId, callId),
  );
  if (!state) notFound();

  return (
    <>
      <div>
        <Link
          href={`/customers/${customerId}/solutions/${solutionId}/calls`}
          className="text-muted text-sm underline"
        >
          Calls
        </Link>
      </div>
      <PageHeader
        as="h3"
        title={state.call.title ?? "Untitled call"}
        description={
          state.call.endedAt
            ? `Ended ${formatDate(state.call.endedAt)}. The transcript is part of this customer's searchable context.`
            : undefined
        }
      />
      <LiveCall
        key={state.call.id}
        customerId={customerId}
        initial={state}
        endCall={endCallAction.bind(null, customerId, callId)}
        setSuggestionState={setSuggestionStateAction.bind(
          null,
          customerId,
          callId,
        )}
      />
    </>
  );
}
