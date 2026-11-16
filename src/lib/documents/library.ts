import { asc, desc, eq, sql } from "drizzle-orm";

import {
  diagrams,
  documents,
  documentVersions,
  solutions,
} from "@/db/customer/schema";

import { getCustomerConnection } from "../customer-connection";

export interface LibraryDocument {
  id: string;
  title: string;
  phase: string | null;
  latestVersion: number;
  updatedAt: Date;
}

export interface LibraryDiagram {
  id: string;
  title: string;
  diagramType: string | null;
  updatedAt: Date;
}

export interface LibrarySolution {
  id: string;
  name: string;
  documents: LibraryDocument[];
  diagrams: LibraryDiagram[];
}

/**
 * Everything Robin has produced for one customer — documents and diagrams —
 * grouped by solution, newest first within each. Solutions with nothing in
 * them are left out.
 *
 * @throws CustomerConnectionError
 */
export async function listCustomerLibrary(
  userId: string,
  customerId: string,
): Promise<LibrarySolution[]> {
  const db = await getCustomerConnection(userId, customerId);
  const [solutionRows, documentRows, diagramRows] = await Promise.all([
    db
      .select({ id: solutions.id, name: solutions.name })
      .from(solutions)
      .orderBy(asc(sql`lower(${solutions.name})`)),
    db
      .select({
        id: documents.id,
        solutionId: documents.solutionId,
        title: documents.title,
        phase: documents.phase,
        updatedAt: documents.updatedAt,
        latestVersion:
          sql<number>`coalesce(max(${documentVersions.version}), 0)`.mapWith(
            Number,
          ),
      })
      .from(documents)
      .leftJoin(documentVersions, eq(documentVersions.documentId, documents.id))
      .groupBy(documents.id)
      .orderBy(desc(documents.updatedAt)),
    db
      .select({
        id: diagrams.id,
        solutionId: diagrams.solutionId,
        title: diagrams.title,
        diagramType: diagrams.diagramType,
        updatedAt: diagrams.updatedAt,
      })
      .from(diagrams)
      .orderBy(desc(diagrams.updatedAt)),
  ]);
  return solutionRows
    .map((solution) => ({
      ...solution,
      documents: documentRows
        .filter((row) => row.solutionId === solution.id)
        .map(({ solutionId: _solutionId, ...document }) => document),
      diagrams: diagramRows
        .filter((row) => row.solutionId === solution.id)
        .map(({ solutionId: _solutionId, ...diagram }) => diagram),
    }))
    .filter((solution) => solution.documents.length + solution.diagrams.length);
}
