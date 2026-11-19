// Sandbox lifecycle (ADR-0022, decision 9). A sandbox expires `SANDBOX_TTL_DAYS` after its owner's last sign-in.
// Cleanup deletes the sandbox venue and the account in one transaction, deletes the accounts whose sandbox never got
// built, and applies the lead retention (decision 7).
//
// INVARIANTS: no venue without a `demo_sandbox` row is ever deleted (purgeVenue checks it), and no account that is a
// member of such a venue is ever deleted (`deleteAccount` checks it).
import { and, eq, lt, notExists, sql } from "drizzle-orm";
import { demoSandboxes, session, user } from "../db/schema";
import type { Db } from "../lib/venue";
import { dropLeadsPastRetention } from "./leads";
import { purgeVenue } from "./purge";
import { SANDBOX_TTL_DAYS } from "./settings";

export interface CleanupResult {
  sandboxes: number;
  accounts: number;
  /** Accounts that had no sandbox: a build that failed, or never ran. */
  orphanAccounts: number;
  leads: number;
}

/** Deletes an account, unless it belongs to a venue that is not a sandbox. Returns whether it was deleted. */
async function deleteAccount(tx: Db, userId: string): Promise<boolean> {
  const real = await tx.execute(sql`
    SELECT 1 FROM venue_memberships m
    WHERE m.user_id = ${userId}
      AND NOT EXISTS (SELECT 1 FROM demo_sandbox s WHERE s.venue_id = m.venue_id)
    LIMIT 1`);
  if (real.rows.length > 0) return false;
  return (await tx.delete(user).where(eq(user.id, userId)).returning({ id: user.id })).length > 0;
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
  let sandboxes = 0;
  let accounts = 0;
  for (const { userId, venueId } of expired) {
    // One transaction per sandbox: a failure halfway leaves both venue and account, and the next run retries them.
    await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      await purgeVenue(t, venueId);
      sandboxes += 1;
      // Sessions, linked accounts and the sandbox row go with the user (ON DELETE CASCADE).
      if (await deleteAccount(t, userId)) accounts += 1;
    });
  }

  // Accounts with no sandbox, old enough and with no recent session. Their sandbox row is gone or never existed, so
  // nothing else will ever reach them.
  const orphans = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        lt(user.createdAt, cutoff),
        notExists(db.select({ one: sql`1` }).from(demoSandboxes).where(eq(demoSandboxes.userId, user.id))),
        notExists(db.select({ one: sql`1` }).from(session).where(and(eq(session.userId, user.id), sql`${session.createdAt} >= ${cutoff}`))),
      ),
    );
  let orphanAccounts = 0;
  for (const { id } of orphans) {
    if (await db.transaction((tx) => deleteAccount(tx as unknown as Db, id))) orphanAccounts += 1;
  }

  const leads = await dropLeadsPastRetention(db, now);
  return { sandboxes, accounts, orphanAccounts, leads };
}

/**
 * Deletes an account that never got a sandbox (a refused or failed first sign-in), with its sessions. Does nothing
 * for an account that owns a sandbox, or that belongs to a venue that is not a sandbox.
 */
export async function deleteSandboxlessAccount(db: Db, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [own] = await t.select({ id: demoSandboxes.userId }).from(demoSandboxes).where(eq(demoSandboxes.userId, userId));
    if (own) return false;
    return deleteAccount(t, userId);
  });
}
