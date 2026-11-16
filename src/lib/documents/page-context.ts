import { notFound } from "next/navigation";

import { orNotFound, requireSolution, type SolutionContext } from "../hub";
import { getDocument, type DocumentDetail } from "./documents";

export interface DocumentContext extends SolutionContext {
  detail: DocumentDetail;
}

/** For pages under …/documents/[documentId]: 404 unless it is this solution's. */
export async function requireDocument(
  customerId: string,
  solutionId: string,
  documentId: string,
  version?: number,
): Promise<DocumentContext> {
  const context = await requireSolution(customerId, solutionId);
  const detail = await orNotFound(() =>
    getDocument(context.user.id, customerId, documentId, version),
  );
  if (!detail || detail.document.solutionId !== context.solution.id) notFound();
  return { ...context, detail };
}
