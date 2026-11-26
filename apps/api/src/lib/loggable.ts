import { DrizzleQueryError } from "drizzle-orm";

/**
 * What may be logged of a caught error. A failed query carries its bound parameters, the database's own error can
 * carry the whole row, and a JSON parse error quotes the request body: each can hold an allergy (ADR-0027). Those two
 * keep what locates the fault and lose the values. Any other error is logged as it is.
 */
export function loggable(error: unknown): unknown {
  if (error instanceof DrizzleQueryError) {
    const cause = error.cause as { code?: string; constraint?: string; message?: string } | undefined;
    return {
      name: "DrizzleQueryError",
      query: error.query,
      code: cause?.code,
      constraint: cause?.constraint,
      message: cause?.message,
      stack: frames(error),
    };
  }
  if (error instanceof SyntaxError) return { name: error.name, stack: frames(error) };
  return error;
}

/** The stack without its header, which repeats the message. Cut at the message's end, since it can span lines. */
function frames(error: Error): string | undefined {
  const at = error.stack?.indexOf(error.message) ?? -1;
  return at < 0 ? undefined : error.stack?.slice(at + error.message.length);
}
