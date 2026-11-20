// What a sandbox venue may not do (ADR-0022, decision 8). A venue is a sandbox when it has a `demo_sandbox` row, and
// for nothing else: the answer does not depend on DEMO_MODE, so the restrictions cannot vanish with the flag (audit
// F9). The API refuses to start with the flag off while that table has rows (demo/guard.ts).
import { count, eq, sql } from "drizzle-orm";
import {
  demoSandboxes,
  floorItems,
  grants,
  guests,
  invitations,
  reservations,
  services,
  tables,
  user,
  waitlist,
} from "../db/schema";
import type { Db } from "../lib/venue";
import { sandboxLimits, type SandboxLimits } from "./settings";

export async function isSandboxVenue(db: Db, venueId: string): Promise<boolean> {
  const [row] = await db
    .select({ venueId: demoSandboxes.venueId })
    .from(demoSandboxes)
    .where(eq(demoSandboxes.venueId, venueId))
    .limit(1);
  return row !== undefined;
}

/** A sandbox hit one of its caps. The app answers 409 `demo_limit_reached`, a code outside docs/contract. */
export class DemoLimitError extends Error {
  constructor(public readonly kind: string) {
    super(`demo sandbox limit reached: ${kind}`);
  }
}

/** Serializes the writes that count against a sandbox's caps, per venue. Held until the transaction ends. */
export async function lockSandbox(tx: Db, venueId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`sandbox-cap:${venueId}`}, 0))`);
}

/**
 * Inside the booking transaction, after the idempotency key was claimed: true when a sandbox already holds its most
 * reservations. Takes the per-venue lock, so two concurrent bookings cannot both pass the last free place.
 * `extraGuests` is checked by `sandboxGuestsFull` once the guest row exists.
 */
export async function sandboxReservationsFull(tx: Db, venueId: string): Promise<boolean> {
  if (!(await isSandboxVenue(tx, venueId))) return false;
  await lockSandbox(tx, venueId);
  const [booked] = await tx.select({ n: count() }).from(reservations).where(eq(reservations.venueId, venueId));
  return (booked?.n ?? 0) >= sandboxLimits().reservations;
}

/** After the guest was linked in the same transaction: true when the sandbox now holds more guests than its cap. */
export async function sandboxGuestsFull(tx: Db, venueId: string): Promise<boolean> {
  if (!(await isSandboxVenue(tx, venueId))) return false;
  await lockSandbox(tx, venueId);
  const [known] = await tx.select({ n: count() }).from(guests).where(eq(guests.venueId, venueId));
  return (known?.n ?? 0) > sandboxLimits().guests;
}

type CapKind = "waitlist" | "tables" | "services" | "floorItems" | "invitations" | "apiKeys";

async function held(tx: Db, kind: CapKind, venueId: string): Promise<number> {
  const table = {
    waitlist: waitlist,
    tables: tables,
    services: services,
    floorItems: floorItems,
    invitations: invitations,
    apiKeys: grants,
  }[kind];
  const [row] = await tx.select({ n: count() }).from(table).where(eq(table.venueId, venueId));
  return row?.n ?? 0;
}

/**
 * Call inside the write's own transaction, before it inserts. Throws `DemoLimitError` when `venueId` is a sandbox
 * that already holds its cap of `kind`. A real venue is never capped. Counting under the venue lock keeps the cap
 * exact under concurrent writes.
 */
export async function enforceSandboxCap(tx: Db, venueId: string, kind: CapKind): Promise<void> {
  if (!(await isSandboxVenue(tx, venueId))) return;
  await lockSandbox(tx, venueId);
  if ((await held(tx, kind, venueId)) >= sandboxLimits()[kind as keyof SandboxLimits]) throw new DemoLimitError(kind);
}

/** The blocklist cap of a sandbox, or null for a real venue. The blocklist already counts under its own lock. */
export async function sandboxBlocklistMax(tx: Db, venueId: string): Promise<number | null> {
  return (await isSandboxVenue(tx, venueId)) ? sandboxLimits().blocklist : null;
}

/** Sandbox venues have no webhooks: an endpoint is a way to send traffic to an address the visitor chose. */
export function sandboxWebhooksBlocked(db: Db, venueId: string): Promise<boolean> {
  return isSandboxVenue(db, venueId);
}

/**
 * Whether the engine may email `to` for this venue. A real venue: always. A sandbox: only the verified address of the
 * account that owns it (the `demo_sandbox` row), so a diner booking in the demo can show a real confirmation without
 * mailing a third party. Another admin who joined the sandbox through an invitation is not the owner: their address
 * is not reachable either. The comparison is exact (case aside), so no spelling trick reaches a second inbox.
 */
export async function mayEmail(db: Db, venueId: string, to: string): Promise<boolean> {
  if (!(await isSandboxVenue(db, venueId))) return true;
  const [owner] = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(demoSandboxes)
    .innerJoin(user, eq(user.id, demoSandboxes.userId))
    .where(eq(demoSandboxes.venueId, venueId))
    .limit(1);
  return owner !== undefined && owner.verified && owner.email.toLowerCase() === to.trim().toLowerCase();
}

/**
 * The Resend key and sender to mail a venue's guests with. A sandbox always uses the operator's configured sender
 * (empty values fall back to the environment in `sendEmail`): whatever `fromEmail` or `resendApiKey` a visitor
 * stored in a sandbox is ignored (audit F12).
 */
export async function mailIdentity(
  db: Db,
  venueId: string,
  venue: { resendApiKey: string | null; fromEmail: string },
): Promise<{ apiKey: string; from: string }> {
  if (await isSandboxVenue(db, venueId)) return { apiKey: "", from: "" };
  return { apiKey: venue.resendApiKey ?? "", from: venue.fromEmail };
}
