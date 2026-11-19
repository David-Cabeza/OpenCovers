// Finds days with free times using only the public availability route. Closed weekdays are skipped without a
// request, and the window and the batch size cap how many requests one search can make.

import { addDays, isoWeekday } from "./dates";
import type { PublicApi } from "./api";

export const LOOKAHEAD_DAYS = 14;
const BATCH = 3;

export interface FreeDay {
  date: string;
  times: string[];
}

/**
 * Up to `want` days, in date order, that have a free time for `party`, from `from` on. It looks at most
 * `LOOKAHEAD_DAYS` days ahead and never past `last` (the booking horizon). A failed request counts as no times,
 * so one bad answer does not hide the other days. `live` lets the caller stop a search nobody waits for.
 */
export async function findFreeDays(options: {
  api: PublicApi;
  weekdays: number[];
  party: number;
  from: string;
  last?: string;
  want: number;
  live?: () => boolean;
}): Promise<FreeDay[]> {
  const { api, weekdays, party, from, last, want, live = () => true } = options;
  const candidates: string[] = [];
  for (let i = 0; i < LOOKAHEAD_DAYS; i += 1) {
    const day = addDays(from, i);
    if (last !== undefined && day > last) break;
    if (weekdays.includes(isoWeekday(day))) candidates.push(day);
  }
  const found: FreeDay[] = [];
  // A search for one day starts with a single request, because the first bookable day is usually the first
  // candidate, and a widget view should not cost more requests than it needs.
  let size = want === 1 ? 1 : BATCH;
  for (let i = 0; i < candidates.length && found.length < want; i += size, size = BATCH) {
    if (!live()) return found;
    const batch = candidates.slice(i, i + size);
    const answers = await Promise.all(batch.map((day) => api.availability(day, party)));
    answers.forEach((answer, n) => {
      const times = answer.ok ? answer.value.times : [];
      if (times.length > 0 && found.length < want) found.push({ date: batch[n], times });
    });
  }
  return found;
}
