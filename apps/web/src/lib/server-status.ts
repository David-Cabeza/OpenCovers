import { ApiError } from "@/lib/api";

/** Shown wherever a request failed because the server could not be reached. */
export const SERVER_UNREACHABLE = "Can't reach the server. Check your connection and try again in a moment.";

/** For a sign-in or sign-up answered with a server error. */
export const SERVER_ERROR = "The server is not responding right now. Try again in a moment.";

// What browsers throw from `fetch` when no answer comes back at all: Chrome, Firefox and Safari.
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;

/**
 * True when a request failed because the server did not answer: the browser gave up (a network error), or a proxy in
 * front of the API answered 502, 503 or 504, or answered a server error with no body of ours. An error the API itself
 * reports, with its own code, is not this: the server is up and said no.
 */
export function isServerUnreachable(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status === 502 || err.status === 503 || err.status === 504 || (err.status >= 500 && err.code === "error");
  }
  return err instanceof TypeError && NETWORK_FAILURE.test(err.message);
}
