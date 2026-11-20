// What the staff app needs to know before and after sign-in on a hosted demo (ADR-0022, decision 11).
// Outside docs/contract: a demo instance's own surface, not the engine's.
import { eq } from "drizzle-orm";
import { demoSandboxes, venueOnlineBooking } from "../db/schema";
import type { Db } from "../lib/venue";
import { widgetOrigin, widgetServingFromEnv } from "../lib/widget-page";
import { demoSettings, SANDBOX_TTL_DAYS } from "./settings";

export interface DemoStatus {
  enabled: boolean;
  googleEnabled: boolean;
  /** Only for a signed-in visitor, and only their own sandbox. */
  venueId?: string;
  bookingKey?: string | null;
  expiresAt?: string;
  /**
   * Where the guest widget lives when it has a host of its own (`WIDGET_ADDRESS`), which the staff host never
   * serves (ADR-0017, Q1). Omitted when the API serves the widget on the staff origin, as in development, so the
   * staff app keeps its relative `/w/{bookingKey}`.
   */
  widgetOrigin?: string;
}

/**
 * `userId` is the signed-in account, or null. With the demo off the answer is `enabled: false` for everyone, so
 * the staff app of a self-hosted instance is what it always was.
 */
export async function demoStatus(db: Db, userId: string | null): Promise<DemoStatus> {
  const settings = demoSettings();
  if (!settings.enabled) return { enabled: false, googleEnabled: false };
  const status: DemoStatus = { enabled: true, googleEnabled: settings.google !== null };
  if (userId === null) return status;
  const [row] = await db
    .select({
      venueId: demoSandboxes.venueId,
      lastSignInAt: demoSandboxes.lastSignInAt,
      bookingKey: venueOnlineBooking.bookingKey,
    })
    .from(demoSandboxes)
    .leftJoin(venueOnlineBooking, eq(venueOnlineBooking.venueId, demoSandboxes.venueId))
    .where(eq(demoSandboxes.userId, userId))
    .limit(1);
  if (!row) return status;
  const serving = widgetServingFromEnv();
  const origin = serving.kind === "host" ? widgetOrigin(serving) : null;
  return {
    ...status,
    ...(origin ? { widgetOrigin: origin } : {}),
    venueId: row.venueId,
    bookingKey: row.bookingKey,
    expiresAt: new Date(row.lastSignInAt.getTime() + SANDBOX_TTL_DAYS * 24 * 3_600_000).toISOString(),
  };
}
