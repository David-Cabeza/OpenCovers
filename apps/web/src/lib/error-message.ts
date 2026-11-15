import { ApiError } from "@/lib/api";

const MESSAGES: Record<string, string> = {
  slot_taken: "One of those tables is already taken at that time. Pick another table.",
  no_suitable_table: "Those tables do not fit this party at that time.",
  table_required: "Assign a table first.",
  forbidden: "Only an admin can do this.",
  reservation_not_found: "This reservation no longer exists.",
};

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? err.code;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function isApiError(err: unknown, code: string): boolean {
  return err instanceof ApiError && err.code === code;
}
