import { getCustomerConnection } from "../customer-connection";
import { extractText } from "../text-extraction";
import { requiredText } from "../validation";
import { contentHash, ingestItem, type IngestResult } from "./ingest";

/**
 * Adds an uploaded file to a customer's context. Uploading the same content
 * under the same name again changes nothing.
 *
 * @throws CustomerConnectionError if the user may not access the customer;
 * ValidationError if the file cannot be used.
 */
export async function uploadFile(
  userId: string,
  customerId: string,
  file: { name: string; bytes: Uint8Array },
): Promise<IngestResult> {
  // Check access before spending time parsing the file.
  const db = await getCustomerConnection(userId, customerId);
  const title = requiredText(file.name, "File name", 255);
  const text = await extractText(file);
  return ingestItem(db, {
    provider: "upload",
    // Uploads have no provider id: identify them by name + content.
    externalId: `upload:${contentHash(`${title}\n${text}`)}`,
    title,
    text,
  });
}
