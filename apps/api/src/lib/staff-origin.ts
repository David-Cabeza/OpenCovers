import type { MiddlewareHandler } from "hono";
import { ERRORS, errorBody, type ErrorCode } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(entry: string): string {
  try {
    return new URL(entry).origin;
  } catch {
    return entry;
  }
}

function declaresBody(headers: Headers): boolean {
  return Number(headers.get("content-length") ?? 0) > 0 || headers.has("transfer-encoding");
}

function isJson(contentType: string): boolean {
  return contentType.split(";")[0]!.trim().toLowerCase() === "application/json";
}

/**
 * Refuses a staff write that a browser could send from another site with the staff session cookie: one from an
 * Origin outside `trustedOrigins`, or one with a body that is not JSON, which a page can send without a CORS
 * preflight. A request with an `apikey` header or no cookie carries no ambient credential and passes, and so does
 * everything under `/v1/public/`, which reads no cookie.
 */
export function staffOriginGuard(trustedOrigins: readonly string[]): MiddlewareHandler {
  const trusted = new Set(trustedOrigins.map(originOf));
  const refuse = (c: Parameters<MiddlewareHandler>[0], code: ErrorCode) => c.json(errorBody(code), ERRORS[code].status);
  return async (c, next) => {
    const { headers } = c.req.raw;
    if (
      SAFE_METHODS.has(c.req.method) ||
      c.req.path.startsWith("/v1/public/") ||
      headers.has("apikey") ||
      !headers.has("cookie")
    ) {
      return next();
    }
    const origin = headers.get("origin");
    if (origin !== null && !trusted.has(origin)) return refuse(c, "forbidden");
    const contentType = headers.get("content-type");
    if (contentType === null ? declaresBody(headers) : !isJson(contentType)) return refuse(c, "invalid_request");
    return next();
  };
}
