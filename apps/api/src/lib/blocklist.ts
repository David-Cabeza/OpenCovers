import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { guestBlocklist, guests, reservations, venues } from "../db/schema";
import {
  blocklistHash,
  blocklistKey,
  normalizeContact,
  venueCountry,
  type BlocklistDigest,
  type BlocklistKey,
  type ContactKey,
} from "./contact";
import { recordMembershipAudit } from "./membership-audit";
import type { Db } from "./memberships";

export const BLOCKLIST_REASONS = ["no_show", "late_cancellation", "conduct", "other"] as const;
export type BlocklistReason = (typeof BLOCKLIST_REASONS)[number];

export const BLOCKLIST_MAX_ENTRIES = 10_000;
export const BLOCKLIST_DEFAULT_LIMIT = 50;
export const BLOCKLIST_MAX_LIMIT = 200;

export interface BlocklistKeyring {
  current: BlocklistKey;
  previous: BlocklistKey | null;
}

const DEV_BLOCKLIST_KEY = "b3BlbmNvdmVycy1kZXYtYmxvY2tsaXN0LWtleS1wdWI=";
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DAY_MS = 86_400_000;

function parseKey(name: string, value: string): BlocklistKey {
  const bytes = BASE64.test(value) ? Buffer.from(value, "base64") : null;
  if (!bytes || bytes.length < 32) {
    throw new Error(
      `${name} must be base64 of at least 32 bytes. Generate one with openssl rand -base64 32.`,
    );
  }
  return blocklistKey(bytes);
}

export function blocklistKeyringFromEnv(env: NodeJS.ProcessEnv = process.env): BlocklistKeyring {
  const previous = env.BLOCKLIST_KEY_PREVIOUS;
  return {
    current: parseKey("BLOCKLIST_KEY", env.BLOCKLIST_KEY || DEV_BLOCKLIST_KEY),
    previous: previous ? parseKey("BLOCKLIST_KEY_PREVIOUS", previous) : null,
  };
}

export const blocklistKeys = blocklistKeyringFromEnv();

/** The contact's hash under every configured key, current first, so a lookup finds entries made before a rotation. */
export function blocklistDigests(
  keyring: BlocklistKeyring,
  venueId: string,
  contact: ContactKey,
): BlocklistDigest[] {
  const keys = keyring.previous ? [keyring.current, keyring.previous] : [keyring.current];
  return keys.map((key) => blocklistHash(key, venueId, contact));
}

export interface BlocklistEntry {
  id: string;
  kind: ContactKey["kind"];
  keyId: string;
  reason: BlocklistReason | null;
  createdBy: string;
  createdAt: Date;
}

const ENTRY = {
  id: guestBlocklist.id,
  kind: guestBlocklist.kind,
  keyId: guestBlocklist.keyId,
  reason: guestBlocklist.reason,
  createdBy: guestBlocklist.createdBy,
  createdAt: guestBlocklist.createdAt,
};

/** Returns null when the venue already holds an entry for this digest. */
export async function insertBlocklistEntry(
  db: Pick<Db, "insert">,
  venueId: string,
  digest: BlocklistDigest,
  input: { reason: BlocklistReason | null; createdBy: string },
): Promise<BlocklistEntry | null> {
  const [entry] = await db
    .insert(guestBlocklist)
    .values({ id: randomUUID(), venueId, ...digest, ...input })
    .onConflictDoNothing({
      target: [guestBlocklist.venueId, guestBlocklist.keyId, guestBlocklist.hash],
    })
    .returning(ENTRY);
  return entry ?? null;
}

export async function findBlocklistEntries(
  db: Pick<Db, "select">,
  venueId: string,
  digests: readonly BlocklistDigest[],
): Promise<BlocklistEntry[]> {
  if (digests.length === 0) return [];
  return db
    .select(ENTRY)
    .from(guestBlocklist)
    .where(
      and(
        eq(guestBlocklist.venueId, venueId),
        or(
          ...digests.map((d) =>
            and(eq(guestBlocklist.keyId, d.keyId), eq(guestBlocklist.hash, d.hash)),
          ),
        ),
      ),
    );
}

/** A position in the list: `created_at` in epoch microseconds, as Postgres stores it, and the id. */
export interface BlocklistCursor {
  micros: string;
  id: string;
}

export function encodeBlocklistCursor(venueId: string, cursor: BlocklistCursor): string {
  return `${venueId}:${cursor.micros}:${cursor.id}`;
}

export function decodeBlocklistCursor(venueId: string, raw: string): BlocklistCursor | null {
  const prefix = `${venueId}:`;
  if (!raw.startsWith(prefix)) return null;
  const match = /^(\d{1,18}):([0-9a-f-]{36})$/.exec(raw.slice(prefix.length));
  return match ? { micros: match[1] as string, id: match[2] as string } : null;
}

const MICROS = sql<string>`(extract(epoch from ${guestBlocklist.createdAt}) * 1000000)::bigint::text`;

/** Newest first. `next` is the position to pass back, or null on the last page. */
export async function listBlocklistEntries(
  db: Pick<Db, "select">,
  venueId: string,
  opts: { limit: number; after?: BlocklistCursor },
): Promise<{ entries: BlocklistEntry[]; next: BlocklistCursor | null }> {
  const after = opts.after
    ? sql`(${guestBlocklist.createdAt}, ${guestBlocklist.id}) < (timestamptz 'epoch' + ${opts.after.micros}::bigint * interval '1 microsecond', ${opts.after.id})`
    : undefined;
  const rows = await db
    .select({ ...ENTRY, micros: MICROS })
    .from(guestBlocklist)
    .where(and(eq(guestBlocklist.venueId, venueId), after))
    .orderBy(desc(guestBlocklist.createdAt), desc(guestBlocklist.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    entries: page.map(({ micros: _, ...entry }) => entry),
    next: rows.length > opts.limit && last ? { micros: last.micros, id: last.id } : null,
  };
}

export async function deleteBlocklistEntry(
  db: Pick<Db, "delete">,
  venueId: string,
  id: string,
): Promise<BlocklistEntry | null> {
  const [entry] = await db
    .delete(guestBlocklist)
    .where(and(eq(guestBlocklist.venueId, venueId), eq(guestBlocklist.id, id)))
    .returning(ENTRY);
  return entry ?? null;
}

/** Who an add or a lookup is about. A contact is the clear value as typed, and is dropped once hashed. */
export type BlocklistSubject = { guestId: string } | { contact: string };

export interface BlocklistEntryView {
  id: string;
  kind: ContactKey["kind"];
  reason: BlocklistReason | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  active: boolean;
}

type Venue = Pick<typeof venues.$inferSelect, "id" | "phoneCountry" | "timezone" | "retentionDays">;

function view(entry: BlocklistEntry, venue: Venue, keyring: BlocklistKeyring): BlocklistEntryView {
  return {
    id: entry.id,
    kind: entry.kind,
    reason: entry.reason,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt.toISOString(),
    expiresAt: new Date(entry.createdAt.getTime() + venue.retentionDays * DAY_MS).toISOString(),
    active: entry.keyId === keyring.current.id || entry.keyId === keyring.previous?.id,
  };
}

async function venueOf(db: Pick<Db, "select">, venueId: string): Promise<Venue | null> {
  const [venue] = await db
    .select({
      id: venues.id,
      phoneCountry: venues.phoneCountry,
      timezone: venues.timezone,
      retentionDays: venues.retentionDays,
    })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  return venue ?? null;
}

type Resolved =
  | { ok: true; keys: ContactKey[]; guestIds: string[] | null }
  | { ok: false; code: "guest_not_found" | "invalid_request" };

/** A guest id stands for the guest and every guest merged into it. Its stored contacts are already normalized. */
async function resolveSubject(db: Pick<Db, "select">, venue: Venue, subject: BlocklistSubject): Promise<Resolved> {
  if ("contact" in subject) {
    const key = normalizeContact(subject.contact, venueCountry(venue));
    return key ? { ok: true, keys: [key], guestIds: null } : { ok: false, code: "invalid_request" };
  }
  const [root] = await db
    .select({ id: guests.id })
    .from(guests)
    .where(
      and(
        eq(guests.venueId, venue.id),
        eq(guests.id, subject.guestId),
        isNull(guests.mergedInto),
        or(isNotNull(guests.email), isNotNull(guests.phone), ne(guests.name, "")),
      ),
    )
    .limit(1);
  if (!root) return { ok: false, code: "guest_not_found" };
  const family: { id: string; email: string | null; phone: string | null }[] = [];
  let frontier = [root.id];
  const seen = new Set<string>();
  while (frontier.length > 0) {
    const rows = await db
      .select({ id: guests.id, email: guests.email, phone: guests.phone })
      .from(guests)
      .where(
        and(
          eq(guests.venueId, venue.id),
          or(inArray(guests.id, frontier), inArray(guests.mergedInto, frontier)),
        ),
      );
    const fresh = rows.filter((g) => !seen.has(g.id));
    for (const g of fresh) seen.add(g.id);
    family.push(...fresh);
    frontier = fresh.map((g) => g.id);
  }
  const keys = family.flatMap((g): ContactKey[] => [
    ...(g.email ? [{ kind: "email" as const, value: g.email }] : []),
    ...(g.phone ? [{ kind: "phone" as const, value: g.phone }] : []),
  ]);
  return { ok: true, keys, guestIds: family.map((g) => g.id) };
}

export type AddResult =
  | {
      ok: true;
      entries: (BlocklistEntryView & { created: boolean })[];
      bookedReservations?: number;
    }
  | { ok: false; code: "venue_not_found" | "guest_not_found" | "invalid_request" | "blocklist_limit_reached" };

/**
 * One entry per normalized contact of the subject. A contact already listed,
 * under any configured key, is returned with `created: false` and writes no
 * audit row. The venue lock serializes adds, so the cap holds under concurrency.
 */
export async function addToBlocklist(
  db: Db,
  keyring: BlocklistKeyring,
  venueId: string,
  actorUserId: string,
  subject: BlocklistSubject,
  reason: BlocklistReason | null,
  max = BLOCKLIST_MAX_ENTRIES,
): Promise<AddResult> {
  return db.transaction(async (tx) => {
    const venue = await venueOf(tx, venueId);
    if (!venue) return { ok: false, code: "venue_not_found" } as const;
    const resolved = await resolveSubject(tx, venue, subject);
    if (!resolved.ok) return resolved;

    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`blocklist:${venueId}`}, 0))`);
    const found: { key: ContactKey; existing: BlocklistEntry | null }[] = [];
    for (const key of resolved.keys) {
      const [existing] = await findBlocklistEntries(tx, venueId, blocklistDigests(keyring, venueId, key));
      found.push({ key, existing: existing ?? null });
    }
    const missing = found.filter((f) => f.existing === null).length;
    if (missing > 0) {
      const [{ held }] = await tx
        .select({ held: count() })
        .from(guestBlocklist)
        .where(eq(guestBlocklist.venueId, venueId));
      if (held + missing > max) return { ok: false, code: "blocklist_limit_reached" } as const;
    }

    const entries: (BlocklistEntryView & { created: boolean })[] = [];
    for (const { key, existing } of found) {
      if (existing) {
        entries.push({ ...view(existing, venue, keyring), created: false });
        continue;
      }
      const inserted = await insertBlocklistEntry(tx, venueId, blocklistHash(keyring.current, venueId, key), {
        reason,
        createdBy: actorUserId,
      });
      if (!inserted) throw new Error("blocklist entry appeared under the venue lock");
      await recordMembershipAudit(tx, venueId, {
        action: "guest_blocked",
        actorUserId,
        blocklistEntryId: inserted.id,
      });
      entries.push({ ...view(inserted, venue, keyring), created: true });
    }

    if (!resolved.guestIds) return { ok: true, entries } as const;
    const [{ booked }] = await tx
      .select({ booked: count() })
      .from(reservations)
      .where(
        and(
          eq(reservations.venueId, venueId),
          inArray(reservations.guestId, resolved.guestIds),
          eq(reservations.status, "booked"),
          eq(reservations.erased, false),
        ),
      );
    return { ok: true, entries, bookedReservations: booked } as const;
  });
}

export type LookupResult =
  | { ok: true; entries: BlocklistEntryView[] }
  | { ok: false; code: "venue_not_found" | "guest_not_found" | "invalid_request" };

export async function lookupBlocklist(
  db: Db,
  keyring: BlocklistKeyring,
  venueId: string,
  subject: BlocklistSubject,
): Promise<LookupResult> {
  const venue = await venueOf(db, venueId);
  if (!venue) return { ok: false, code: "venue_not_found" };
  const resolved = await resolveSubject(db, venue, subject);
  if (!resolved.ok) return resolved;
  const digests = resolved.keys.flatMap((key) => blocklistDigests(keyring, venueId, key));
  const entries = await findBlocklistEntries(db, venueId, digests);
  entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  return { ok: true, entries: entries.map((e) => view(e, venue, keyring)) };
}

export type PageResult =
  | { ok: true; entries: BlocklistEntryView[]; next: BlocklistCursor | null }
  | { ok: false; code: "venue_not_found" };

export async function pageBlocklist(
  db: Db,
  keyring: BlocklistKeyring,
  venueId: string,
  opts: { limit: number; after?: BlocklistCursor },
): Promise<PageResult> {
  const venue = await venueOf(db, venueId);
  if (!venue) return { ok: false, code: "venue_not_found" };
  const page = await listBlocklistEntries(db, venueId, opts);
  return { ok: true, entries: page.entries.map((e) => view(e, venue, keyring)), next: page.next };
}

export type RemoveResult =
  | { ok: true; entry: BlocklistEntryView }
  | { ok: false; code: "venue_not_found" | "blocklist_entry_not_found" };

export async function removeFromBlocklist(
  db: Db,
  keyring: BlocklistKeyring,
  venueId: string,
  actorUserId: string,
  entryId: string,
): Promise<RemoveResult> {
  return db.transaction(async (tx) => {
    const venue = await venueOf(tx, venueId);
    if (!venue) return { ok: false, code: "venue_not_found" } as const;
    const entry = await deleteBlocklistEntry(tx, venueId, entryId);
    if (!entry) return { ok: false, code: "blocklist_entry_not_found" } as const;
    await recordMembershipAudit(tx, venueId, {
      action: "guest_unblocked",
      actorUserId,
      blocklistEntryId: entry.id,
    });
    return { ok: true, entry: view(entry, venue, keyring) } as const;
  });
}

/** Exactly one of a non-empty `guestId` or `contact`, as strings. */
export function parseBlocklistSubject(body: unknown): BlocklistSubject | null {
  if (typeof body !== "object" || body === null) return null;
  const { guestId, contact } = body as Record<string, unknown>;
  if ((guestId === undefined) === (contact === undefined)) return null;
  if (guestId !== undefined) return typeof guestId === "string" && guestId !== "" ? { guestId } : null;
  return typeof contact === "string" && contact.trim() !== "" ? { contact } : null;
}

/** A missing or null reason is no reason. Undefined means the value is not a reason code. */
export function parseBlocklistReason(value: unknown): BlocklistReason | null | undefined {
  if (value === undefined || value === null) return null;
  return BLOCKLIST_REASONS.find((r) => r === value);
}
