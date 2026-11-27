import type { UseQueryResult } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { dateTime, toIsoDate, todayIso } from "@/lib/date";

type Watched = Pick<UseQueryResult, "data" | "dataUpdatedAt" | "isError" | "isPaused">;

/**
 * What a screen says when it shows data it could not read again, or null while it is current. A read that failed, and
 * one the browser holds back because it is offline, leave the old data on screen. The time is the oldest of them.
 */
export function useStaleMessage(queries: Watched[]): string | null {
  const t = useT();
  const times = queries.filter((q) => q.data !== undefined && (q.isError || q.isPaused)).map((q) => q.dataUpdatedAt);
  if (times.length === 0) return null;
  const since = new Date(Math.min(...times));
  const day = toIsoDate(since) === todayIso() ? {} : ({ day: "numeric", month: "short" } as const);
  return t("layout.stale.message", { time: dateTime(since.toISOString(), { hour: "2-digit", minute: "2-digit", ...day }) });
}
