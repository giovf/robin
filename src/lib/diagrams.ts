import { desc, eq } from "drizzle-orm";

import { isUuid } from "@/db/customer/database-url";
import { diagrams, type Diagram } from "@/db/customer/schema";

import { getCustomerAgent } from "./agent/customer-agent";
import { DIAGRAM_TYPES, type DiagramTypeId } from "./agent/prompts";
import { getCustomerConnection } from "./customer-connection";
import { optionalText, requiredText, ValidationError } from "./validation";

export const DIAGRAM_TITLE_MAX_LENGTH = 160;
export const DIAGRAM_SOURCE_MAX_LENGTH = 50_000;
export const DIAGRAM_BRIEF_MAX_LENGTH = 1000;

export function isDiagramType(value: unknown): value is DiagramTypeId {
  return DIAGRAM_TYPES.some((type) => type.id === value);
}

export async function listDiagrams(
  userId: string,
  customerId: string,
  solutionId: string,
): Promise<Diagram[]> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(solutionId)) return [];
  return db
    .select()
    .from(diagrams)
    .where(eq(diagrams.solutionId, solutionId))
    .orderBy(desc(diagrams.updatedAt));
}

export async function getDiagram(
  userId: string,
  customerId: string,
  diagramId: string,
): Promise<Diagram | null> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(diagramId)) return null;
  const [diagram] = await db
    .select()
    .from(diagrams)
    .where(eq(diagrams.id, diagramId))
    .limit(1);
  return diagram ?? null;
}

/**
 * Has the customer's agent draw a diagram (as Mermaid code) and stores it.
 *
 * @throws ValidationError, LlmError, CustomerConnectionError
 */
export async function generateDiagram(
  userId: string,
  customerId: string,
  input: { solutionId: string; type: unknown; brief?: unknown },
): Promise<Diagram> {
  if (!isDiagramType(input.type)) {
    throw new ValidationError("Choose a diagram type.");
  }
  const brief = optionalText(
    input.brief,
    "Description",
    DIAGRAM_BRIEF_MAX_LENGTH,
  );
  const type = DIAGRAM_TYPES.find((candidate) => candidate.id === input.type);
  const agent = await getCustomerAgent(userId, customerId);
  const sourceCode = await agent.generateDiagram({
    solutionId: input.solutionId,
    type: input.type,
    brief,
  });
  if (!sourceCode) throw new ValidationError("The diagram came back empty.");
  const db = await getCustomerConnection(userId, customerId);
  const [diagram] = await db
    .insert(diagrams)
    .values({
      solutionId: input.solutionId,
      title: brief
        ? brief.slice(0, DIAGRAM_TITLE_MAX_LENGTH)
        : `${type?.label} diagram`,
      sourceCode,
      format: "mermaid",
      diagramType: input.type,
    })
    .returning();
  return diagram;
}

/** Returns null if the diagram does not exist. @throws ValidationError */
export async function saveDiagram(
  userId: string,
  customerId: string,
  diagramId: string,
  input: { title: unknown; sourceCode: unknown },
): Promise<Diagram | null> {
  const title = requiredText(input.title, "Title", DIAGRAM_TITLE_MAX_LENGTH);
  const sourceCode =
    typeof input.sourceCode === "string"
      ? input.sourceCode.replace(/\r\n?/g, "\n").trim()
      : "";
  if (!sourceCode) throw new ValidationError("The diagram source is empty.");
  if (sourceCode.length > DIAGRAM_SOURCE_MAX_LENGTH) {
    throw new ValidationError("The diagram source is too long.");
  }
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(diagramId)) return null;
  const [diagram] = await db
    .update(diagrams)
    .set({ title, sourceCode })
    .where(eq(diagrams.id, diagramId))
    .returning();
  return diagram ?? null;
}

export async function deleteDiagram(
  userId: string,
  customerId: string,
  diagramId: string,
): Promise<boolean> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(diagramId)) return false;
  const deleted = await db
    .delete(diagrams)
    .where(eq(diagrams.id, diagramId))
    .returning({ id: diagrams.id });
  return deleted.length > 0;
}
