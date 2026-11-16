export interface ChunkOptions {
  /** Upper bound on a chunk's length, in characters (~4 per token). */
  maxChars?: number;
  /** Characters repeated from the end of one chunk at the start of the next. */
  overlapChars?: number;
}

/** Sized to fit the embedding model's 512-token input with room to spare. */
export const DEFAULT_CHUNK_MAX_CHARS = 1600;
export const DEFAULT_CHUNK_OVERLAP_CHARS = 200;

/** Splits text that is too long at the best boundary available. */
function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    // Prefer the end of a sentence, then a line, then a word.
    let cut = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
    );
    if (cut < maxChars / 2) cut = window.lastIndexOf("\n");
    if (cut < maxChars / 2) cut = window.lastIndexOf(" ");
    if (cut < maxChars / 2) cut = maxChars - 1;
    pieces.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** The tail of `text` to carry into the next chunk, starting at a word. */
function overlapTail(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length <= overlapChars) return "";
  const tail = text.slice(-overlapChars);
  const space = tail.indexOf(" ");
  return space === -1 ? tail : tail.slice(space + 1);
}

/**
 * Splits text into chunks for embedding: paragraphs are kept together where
 * they fit, long paragraphs are split at sentence boundaries, and each chunk
 * starts with a little of the previous one so context is not lost at the seam.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? DEFAULT_CHUNK_MAX_CHARS;
  const overlapChars = Math.min(
    options.overlapChars ?? DEFAULT_CHUNK_OVERLAP_CHARS,
    Math.floor(maxChars / 2),
  );
  const room = maxChars - overlapChars;

  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLong(paragraph, room));

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const joined = current ? `${current}\n\n${paragraph}` : paragraph;
    if (joined.length <= maxChars || !current) {
      current = joined;
      continue;
    }
    chunks.push(current);
    const tail = overlapTail(current, overlapChars);
    current = tail ? `${tail}\n\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}
