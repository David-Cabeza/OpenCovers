export const COMMENTARY_MAX_LENGTH = 500;

export function isCommentary(value: unknown): value is string {
  return typeof value === "string" && value.trim().length <= COMMENTARY_MAX_LENGTH;
}

export function normalizeCommentary(value: string): string {
  return value.trim();
}
