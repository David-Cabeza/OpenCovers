// The startup guard of ADR-0022 decision 10 (audit F2 and F9). The demo runs on its own database, never over a real
// instance, and a real instance never inherits the demo's rows:
//
// - DEMO_MODE=1: refuse when a venue has no `demo_sandbox` row (a venue `provisionSandbox` did not create), and when
//   an account holds a password (`credential`) login. The demo turns password sign-up off, so a credential account
//   can only come from a real instance, and `demo:cleanup` deletes accounts.
// - DEMO_MODE off: refuse when `demo_sandbox` has rows. Without the flag the restrictions would otherwise be one
//   unset variable away from vanishing.
import { sql } from "drizzle-orm";
import type { Db } from "../lib/venue";

export class DemoGuardError extends Error {}

function isMissingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01";
}

export async function assertDemoDatabase(db: Db, demoEnabled: boolean): Promise<void> {
  if (demoEnabled) {
    const venues = await db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM venues v WHERE NOT EXISTS (SELECT 1 FROM demo_sandbox s WHERE s.venue_id = v.id)`,
    );
    const unmarked = Number(venues.rows[0]?.n ?? 0);
    if (unmarked > 0) {
      throw new DemoGuardError(
        `DEMO_MODE=1 refused: ${unmarked} venue(s) are not demo sandboxes. The demo needs its own database, never one that holds a real instance's data.`,
      );
    }
    const credentials = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM account WHERE provider_id = 'credential'`);
    const logins = Number(credentials.rows[0]?.n ?? 0);
    if (logins > 0) {
      throw new DemoGuardError(
        `DEMO_MODE=1 refused: ${logins} account(s) have a password login. The demo signs in by magic link or Google only, so this database belongs to a real instance.`,
      );
    }
    return;
  }
  try {
    const rows = await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM demo_sandbox`);
    const sandboxes = Number(rows.rows[0]?.n ?? 0);
    if (sandboxes > 0) {
      throw new DemoGuardError(
        `DEMO_MODE is off but this database holds ${sandboxes} demo sandbox(es). Set DEMO_MODE=1, or use another database: without the flag a sandbox would lose its restrictions.`,
      );
    }
  } catch (error) {
    // A database that was never migrated has no demo tables, so it holds no sandbox.
    if (!isMissingTable(error)) throw error;
  }
}
