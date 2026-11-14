import { ValidationError } from "./validation";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Extensions accepted for upload, for the file picker and error messages. */
export const UPLOAD_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".html",
  ".htm",
] as const;

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|tr|div)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extracts plain text from an uploaded file, chosen by its extension.
 *
 * @throws ValidationError for unsupported, oversized, unreadable or empty files.
 */
export async function extractText(file: {
  name: string;
  bytes: Uint8Array;
}): Promise<string> {
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ValidationError(
      `Files can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    );
  }
  const kind = extension(file.name);
  let text: string;
  try {
    if (kind === ".pdf") {
      const { extractText: extractPdfText } = await import("unpdf");
      const result = await extractPdfText(new Uint8Array(file.bytes), {
        mergePages: true,
      });
      text = result.text;
    } else if (kind === ".docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(file.bytes),
      });
      text = result.value;
    } else if (kind === ".html" || kind === ".htm") {
      text = htmlToText(new TextDecoder().decode(file.bytes));
    } else if ((UPLOAD_EXTENSIONS as readonly string[]).includes(kind)) {
      text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    } else {
      throw new ValidationError(
        `Unsupported file type. Upload one of: ${UPLOAD_EXTENSIONS.join(", ")}.`,
      );
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(
      `Could not read "${file.name}". Is it a valid ${kind || "text"} file?`,
    );
  }
  text = text.replaceAll("\u0000", "").trim();
  if (!text) {
    throw new ValidationError(
      `No text found in "${file.name}". Scanned documents need OCR first.`,
    );
  }
  return text;
}
