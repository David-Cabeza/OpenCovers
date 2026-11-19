// Demo leads (ADR-0022, decision 7). A lead is an address a visitor proved they own. The consent claim travels with
// the sign-in request, and is applied only once the address is verified: for a magic link, when the link is opened;
// for Google, which verifies the address itself, when the session starts. No HTTP route reads this table.
import { createHash } from "node:crypto";
import { and, eq, like, lt, sql } from "drizzle-orm";
import { demoLeads, verification } from "../db/schema";
import type { Db } from "../lib/venue";
import { CONSENT_HEADER, LOCALE_HEADER } from "./settings";

export type LeadSource = "magic-link" | "google";

export interface LeadClaim {
  /** The version of the consent text the form showed. Null when the box was not ticked. */
  consentVersion: string | null;
  locale: string;
  name: string | null;
}

const VERSION = /^[A-Za-z0-9._-]{1,32}$/;
const LOCALE = /^[a-z]{2}(-[A-Za-z]{2})?$/;
const CLAIM_PREFIX = "demo-lead:";
const CLAIM_TTL_MS = 60 * 60_000;

/** Reads the claim from a sign-in request's headers. Anything malformed counts as "no consent" and "en". */
export function claimFromHeaders(headers: Headers | undefined, name?: string | null): LeadClaim {
  const version = headers?.get(CONSENT_HEADER)?.trim() ?? "";
  const explicit = headers?.get(LOCALE_HEADER)?.trim() ?? "";
  const accept = headers?.get("accept-language")?.split(",")[0]?.split(";")[0]?.trim() ?? "";
  const locale = [explicit, accept].find((l) => LOCALE.test(l)) ?? "en";
  const cleanName = name?.trim().slice(0, 120);
  return {
    consentVersion: VERSION.test(version) ? version : null,
    locale: locale.toLowerCase(),
    name: cleanName ? cleanName : null,
  };
}

const claimKey = (token: string) => `${CLAIM_PREFIX}${createHash("sha256").update(token).digest("hex")}`;

/** Parks a claim next to a magic link token, in the `verification` table Better Auth already cleans. */
export async function stashClaim(db: Db, token: string, claim: LeadClaim): Promise<void> {
  await db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier: claimKey(token),
    value: JSON.stringify(claim),
    expiresAt: new Date(Date.now() + CLAIM_TTL_MS),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** Returns and removes the claim parked for `token`, if any. */
export async function takeClaim(db: Db, token: string): Promise<LeadClaim | null> {
  const rows = await db.delete(verification).where(eq(verification.identifier, claimKey(token))).returning();
  const row = rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.value) as LeadClaim;
  } catch {
    return null;
  }
}

/** Drops parked claims whose link was never opened. */
export async function dropStaleClaims(db: Db, now: Date = new Date()): Promise<number> {
  const rows = await db
    .delete(verification)
    .where(and(like(verification.identifier, `${CLAIM_PREFIX}%`), lt(verification.expiresAt, now)))
    .returning({ id: verification.id });
  return rows.length;
}

/**
 * Records a verified sign-in. A repeat sign-in refreshes `last_seen_at`. Consent is only ever added here, never
 * removed: unticking the box on a later sign-in is not a withdrawal, which is a separate request to the operator.
 */
export async function recordLead(
  db: Db,
  input: { email: string; source: LeadSource; claim: LeadClaim | null },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const claim = input.claim;
  const consent = claim?.consentVersion ?? null;
  await db
    .insert(demoLeads)
    .values({
      email,
      name: claim?.name ?? null,
      source: input.source,
      locale: claim?.locale ?? "en",
      contactConsent: consent !== null,
      consentTextVersion: consent,
    })
    .onConflictDoUpdate({
      target: demoLeads.email,
      set: {
        lastSeenAt: sql`now()`,
        name: sql`coalesce(${demoLeads.name}, ${claim?.name ?? null})`,
        ...(consent !== null ? { contactConsent: true, consentTextVersion: consent } : {}),
      },
    });
}

/** Consented leads as CSV (header included), oldest first. The one way leads leave the database. */
export async function consentedLeadsCsv(db: Db): Promise<string> {
  const rows = await db
    .select()
    .from(demoLeads)
    .where(eq(demoLeads.contactConsent, true))
    .orderBy(demoLeads.createdAt);
  const cell = (value: string | null) => {
    const text = value ?? "";
    // A leading =, +, - or @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = rows.map((r) =>
    [r.email, r.name, r.source, r.locale, r.createdAt.toISOString(), r.lastSeenAt.toISOString(), r.consentTextVersion]
      .map(cell)
      .join(","),
  );
  return ["email,name,source,locale,created_at,last_seen_at,consent_text_version", ...lines].join("\n") + "\n";
}
