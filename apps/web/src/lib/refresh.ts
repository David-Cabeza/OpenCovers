import type { Query } from "@tanstack/react-query";

/** How often a service screen left open asks again. Reads under `/v1/venues` are not rate limited. */
export const REFRESH_MS = 30_000;

/**
 * For the queries of a screen the team leaves open: they ask again while the tab is visible, when it comes back and
 * when the network does. A query that never loaded is not asked on the timer, because asking again would swap its
 * error message for the loading skeleton every time.
 */
export const liveQuery = {
  refetchInterval: (query: Query<any, any, any, any>) => (query.state.data === undefined ? false : REFRESH_MS),
  refetchOnWindowFocus: "always",
  refetchOnReconnect: "always",
} as const;
