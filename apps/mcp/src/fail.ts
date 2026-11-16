import { ApiError } from "./client.js";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function retrySuffix(retryable: boolean | undefined): string {
  if (retryable === undefined) return "";
  return retryable ? " (retryable)" : " (not retryable)";
}

export function fail(err: unknown): ToolResult {
  const message =
    err instanceof ApiError
      ? `API error ${err.status}: ${err.code}${retrySuffix(err.retryable)}`
      : err instanceof Error
        ? err.message
        : String(err);
  return { isError: true, content: [{ type: "text", text: message }] };
}
