import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";

export const SIGNUP_MODES = ["open", "first-user", "closed"] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];

export function signupMode(
  value: string | undefined = process.env.SIGNUP,
): SignupMode {
  if (value === undefined || value === "") return "open";
  if ((SIGNUP_MODES as readonly string[]).includes(value)) {
    return value as SignupMode;
  }
  throw new Error(
    `SIGNUP must be one of ${SIGNUP_MODES.join(", ")}. Got "${value}".`,
  );
}

export type SignupDecision =
  | { allowed: false }
  | { allowed: true; firstSignup: boolean };

export async function decideSignup(
  db: NodePgDatabase<typeof schema>,
  mode: SignupMode,
): Promise<SignupDecision> {
  if (mode === "open") return { allowed: true, firstSignup: false };
  if (mode === "closed") return { allowed: false };
  const result = await db.execute<{ found: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM "user") AS found`,
  );
  if (result.rows[0]?.found) return { allowed: false };
  return { allowed: true, firstSignup: true };
}
