// Sandbox lifecycle (ADR-0022, decision 9). A sandbox expires `SANDBOX_TTL_DAYS` after its owner's last sign-in.
// Cleanup deletes the sandbox venue and the account, and keeps the `demo_lead` row.
import { eq, lt } from "drizzle-orm";
import { demoSandboxes, user } from "../db/schema";
import type { Db } from "../lib/venue";
import { dropStaleClaims } from "./leads";
import { purgeVenue } from "./purge";
import { SANDBOX_TTL_DAYS } from "./settings";

export interface CleanupResult {
  sandboxes: number;
  accounts: number;
}

export async function cleanupExpiredSandboxes(
  db: Db,
  { now = new Date(), ttlDays = SANDBOX_TTL_DAYS }: { now?: Date; ttlDays?: number } = {},
): Promise<CleanupResult> {
  const cutoff = new Date(now.getTime() - ttlDays * 864e5);
  const expired = await db
    .select({ userId: demoSandboxes.userId, venueId: demoSandboxes.venueId })
    .from(demoSandboxes)
    .where(lt(demoSandboxes.lastSignInAt, cutoff));
  let accounts = 0;
  for (const { userId, venueId } of expired) {
    await purgeVenue(db, venueId);
    // Sessions, linked accounts and the sandbox row go with the user (ON DELETE CASCADE).
    accounts += (await db.delete(user).where(eq(user.id, userId)).returning({ id: user.id })).length;
  }
  await dropStaleClaims(db, now);
  return { sandboxes: expired.length, accounts };
}
