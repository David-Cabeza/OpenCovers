// Who may get a new sandbox (ADR-0022, decision 8b and 8c): one per normalized address, a cap of live sandboxes and
// a cap of new ones per day. Checked before an account is created and again, under a lock, before a sandbox row is
// written.
import { and, count, eq, gt, ne, sql } from "drizzle-orm";
import { demoSandboxes, user } from "../db/schema";
import type { Db } from "../lib/venue";
import { normalizeEmail } from "./normalize";
import { sandboxLimits } from "./settings";

/** Why a visitor gets no sandbox. `full` is the "demo is full for now" page. */
export type Refusal = "full" | "address_in_use" | "busy" | "invalid_address";

export class DemoRefusal extends Error {
  constructor(public readonly reason: Refusal) {
    super(`demo sandbox refused: ${reason}`);
  }
}

/** The message and Better Auth code of each refusal. These codes live under /api/auth, outside docs/contract. */
export const REFUSALS: Record<Refusal, { code: string; message: string }> = {
  full: { code: "DEMO_FULL", message: "The demo is full for now. Try again later, or deploy OpenCovers yourself." },
  busy: { code: "DEMO_BUSY", message: "The demo is busy. Try again in a minute." },
  address_in_use: {
    code: "DEMO_ADDRESS_IN_USE",
    message: "This address already has a demo. Sign in with the address you first used.",
  },
  invalid_address: { code: "INVALID_EMAIL", message: "This email address is not valid." },
};

/**
 * `userId` is the account asking, or null for an address that has none yet. An account that already owns a sandbox is
 * a returning visitor and always passes.
 */
export async function admissionFor(db: Db, normalized: string, userId: string | null): Promise<Refusal | null> {
  if (userId) {
    const [own] = await db.select({ id: demoSandboxes.userId }).from(demoSandboxes).where(eq(demoSandboxes.userId, userId));
    if (own) return null;
  }
  const [taken] = await db
    .select({ id: demoSandboxes.userId })
    .from(demoSandboxes)
    .where(userId ? and(eq(demoSandboxes.normalizedEmail, normalized), ne(demoSandboxes.userId, userId)) : eq(demoSandboxes.normalizedEmail, normalized))
    .limit(1);
  if (taken) return "address_in_use";
  const limits = sandboxLimits();
  const [live] = await db.select({ n: count() }).from(demoSandboxes);
  if ((live?.n ?? 0) >= limits.maxSandboxes) return "full";
  const [fresh] = await db
    .select({ n: count() })
    .from(demoSandboxes)
    .where(gt(demoSandboxes.createdAt, sql`now() - interval '24 hours'`));
  if ((fresh?.n ?? 0) >= limits.maxNewPerDay) return "full";
  return null;
}

/** The admission check for an address typed in a sign-in form, before any account exists for it. */
export async function admissionForEmail(db: Db, email: string): Promise<Refusal | null> {
  const normalized = normalizeEmail(email);
  if (normalized === null) return "invalid_address";
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.trim().toLowerCase())).limit(1);
  return admissionFor(db, normalized, existing?.id ?? null);
}
