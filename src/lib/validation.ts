/** A problem with user input; its message is safe to show in the UI. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Trims a required single-line text field and enforces a length limit. */
export function requiredText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ValidationError(`${label} is required.`);
  if (text.length > maxLength) {
    throw new ValidationError(
      `${label} must be at most ${maxLength} characters.`,
    );
  }
  return text;
}

/** Trims an optional text field; empty becomes null. */
export function optionalText(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > maxLength) {
    throw new ValidationError(
      `${label} must be at most ${maxLength} characters.`,
    );
  }
  return text;
}
