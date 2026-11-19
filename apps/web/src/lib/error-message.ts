import { ApiError } from "@/lib/api";
import { t, type MessageKey } from "@/i18n";
import { CATALOG } from "@/i18n/catalog";

const apiKey = (code: string) => `errors.api.${code}` as MessageKey;
const authKey = (code: string) => `errors.auth.${code}` as MessageKey;
const has = (key: MessageKey) => Object.hasOwn(CATALOG.en, key);

/** The message for one of the API's documented error codes (docs/contract/errors.md), or null for a code this app does not know. */
export function apiErrorText(code: string): string | null {
  return has(apiKey(code)) ? t(apiKey(code)) : null;
}

/**
 * Turn any thrown value into text safe to show a staff user.
 * Unknown codes and plain errors (network failures included) use the
 * caller's fallback, so raw codes and internals are never shown.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t("errors.api.rate_limited");
    return apiErrorText(err.code) ?? fallback;
  }
  return fallback;
}

/** Same, for Better Auth `{ error }` results (`status`, UPPER_SNAKE `code`). */
export function authErrorMessage(
  error: { status?: number; code?: string; message?: string } | null | undefined,
  fallback: string,
): string {
  if (error?.status === 429) return t("errors.api.rate_limited");
  if (error?.status !== undefined && error.status >= 500) return t("errors.serverError");
  if (error?.code === "INVALID_INVITATION") return t("errors.api.invalid_invitation");
  if (error?.code && has(authKey(error.code))) return t(authKey(error.code));
  // The demo challenge endpoint answers in the API's own vocabulary (`invalid_request`), not Better Auth's.
  if (error?.code && has(apiKey(error.code))) return t(apiKey(error.code));
  return error?.message || fallback;
}

export function isApiError(err: unknown, code: string): boolean {
  return err instanceof ApiError && err.code === code;
}
