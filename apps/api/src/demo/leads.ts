// Demo leads (ADR-0022, decision 7). A row exists only for a visitor who ticked the consent box, and it is written
// by `POST /api/demo/consent` from a signed-in session, for the verified address of that account (amendment of
// 2026-11-20). Nothing else writes this table. No HTTP route reads it.
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { demoLeads } from "../db/schema";
import { LOCALES } from "../lib/online-booking";
import type { Db } from "../lib/venue";
import { CONSENT_TEXT_VERSION, LEAD_RETENTION_MONTHS } from "./settings";

export type LeadSource = "magic-link" | "google";

export const NAME_MAX = 120;

export interface ConsentInput {
  version: string;
  locale: string;
  name: string | null;
}

/** Strict validation of the consent request body. Null when anything is off. */
export function parseConsent(body: unknown): ConsentInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { version, locale, name, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (version !== CONSENT_TEXT_VERSION) return null;
  if (typeof locale !== "string" || !(LOCALES as readonly string[]).includes(locale)) return null;
  let clean: string | null = null;
  if (name !== undefined && name !== null) {
    if (typeof name !== "string") return null;
    const trimmed = name.normalize("NFKC").trim();
    // eslint-disable-next-line no-control-regex
    if (trimmed.length > NAME_MAX || /[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) return null;
    clean = trimmed === "" ? null : trimmed;
  }
  return { version, locale, name: clean };
}

/**
 * Records the consent of a signed-in account for its own verified address. A repeat refreshes `last_seen_at` and, if
 * the lead had withdrawn, a new consent clears the withdrawal.
 */
export async function recordConsent(
  db: Db,
  input: { email: string; source: LeadSource; consent: ConsentInput },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const { consent } = input;
  await db
    .insert(demoLeads)
    .values({
      email,
      name: consent.name,
      source: input.source,
      locale: consent.locale,
      contactConsent: true,
      consentTextVersion: consent.version,
    })
    .onConflictDoUpdate({
      target: demoLeads.email,
      set: {
        lastSeenAt: sql`now()`,
        name: sql`coalesce(${consent.name}, ${demoLeads.name})`,
        locale: consent.locale,
        contactConsent: true,
        consentTextVersion: consent.version,
        withdrawnAt: null,
      },
    });
}

/** A consented lead signed in again: keeps its 12 months running. Does nothing for a visitor who never consented. */
export async function touchLead(db: Db, email: string): Promise<void> {
  await db
    .update(demoLeads)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(demoLeads.email, email.trim().toLowerCase()));
}

/** Deletes consented leads whose last sign-in is older than the retention, and any row without consent. */
export async function dropLeadsPastRetention(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - LEAD_RETENTION_MONTHS);
  const rows = await db
    .delete(demoLeads)
    .where(sql`${demoLeads.contactConsent} = false OR ${lt(demoLeads.lastSeenAt, cutoff)}`)
    .returning({ email: demoLeads.email });
  return rows.length;
}

/** Erasure of one address (`pnpm demo:leads --erase <email>`). Returns how many rows were deleted. */
export async function eraseLead(db: Db, email: string): Promise<number> {
  const rows = await db
    .delete(demoLeads)
    .where(eq(demoLeads.email, email.trim().normalize("NFKC").toLowerCase()))
    .returning({ email: demoLeads.email });
  return rows.length;
}

/** Consented, not withdrawn leads as CSV (header included), oldest first. The one way leads leave the database. */
export async function consentedLeadsCsv(db: Db): Promise<string> {
  const rows = await db
    .select()
    .from(demoLeads)
    .where(and(eq(demoLeads.contactConsent, true), isNull(demoLeads.withdrawnAt)))
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
