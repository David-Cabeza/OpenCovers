// What a sandbox venue may not do (ADR-0022, decision 8). Every check returns the permissive answer at once when
// DEMO_MODE is off, so a self-hosted instance pays nothing and behaves as before.
import { and, count, eq } from "drizzle-orm";
import { demoSandboxes, guests, reservations, user, venueMemberships } from "../db/schema";
import type { Db } from "../lib/venue";
import { demoMode, sandboxCaps } from "./settings";

export async function isSandboxVenue(db: Db, venueId: string): Promise<boolean> {
  if (!demoMode()) return false;
  const [row] = await db
    .select({ venueId: demoSandboxes.venueId })
    .from(demoSandboxes)
    .where(eq(demoSandboxes.venueId, venueId))
    .limit(1);
  return row !== undefined;
}

/** True when a sandbox already holds its most reservations or guests. A real venue is never capped. */
export async function sandboxFull(db: Db, venueId: string): Promise<boolean> {
  if (!(await isSandboxVenue(db, venueId))) return false;
  const caps = sandboxCaps();
  const [booked] = await db.select({ n: count() }).from(reservations).where(eq(reservations.venueId, venueId));
  if ((booked?.n ?? 0) >= caps.reservations) return true;
  const [known] = await db.select({ n: count() }).from(guests).where(eq(guests.venueId, venueId));
  return (known?.n ?? 0) >= caps.guests;
}

/** Sandbox venues have no webhooks: an endpoint is a way to send traffic to an address the visitor chose. */
export function sandboxWebhooksBlocked(db: Db, venueId: string): Promise<boolean> {
  return isSandboxVenue(db, venueId);
}

/**
 * Whether the engine may email `to` for this venue. A real venue: always. A sandbox: only the verified address of
 * its owner, so a diner booking in the demo can show a real confirmation without mailing a third party.
 */
export async function mayEmail(db: Db, venueId: string, to: string): Promise<boolean> {
  if (!(await isSandboxVenue(db, venueId))) return true;
  const owners = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(venueMemberships)
    .innerJoin(user, eq(user.id, venueMemberships.userId))
    .where(and(eq(venueMemberships.venueId, venueId), eq(venueMemberships.role, "admin")));
  const target = to.trim().toLowerCase();
  return owners.some((o) => o.verified && o.email.toLowerCase() === target);
}
