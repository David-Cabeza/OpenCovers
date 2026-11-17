import { randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { guestBlocklist } from "../db/schema";
import {
  blocklistHash,
  blocklistKey,
  type BlocklistDigest,
  type BlocklistKey,
  type ContactKey,
} from "./contact";
import type { Db } from "./memberships";

export const BLOCKLIST_REASONS = ["no_show", "late_cancellation", "conduct", "other"] as const;
export type BlocklistReason = (typeof BLOCKLIST_REASONS)[number];

export interface BlocklistKeyring {
  current: BlocklistKey;
  previous: BlocklistKey | null;
}

const DEV_BLOCKLIST_KEY = "b3BlbmNvdmVycy1kZXYtYmxvY2tsaXN0LWtleS1wdWI=";
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

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

/** Newest first. */
export async function listBlocklistEntries(
  db: Pick<Db, "select">,
  venueId: string,
  limit: number,
): Promise<BlocklistEntry[]> {
  return db
    .select(ENTRY)
    .from(guestBlocklist)
    .where(eq(guestBlocklist.venueId, venueId))
    .orderBy(desc(guestBlocklist.createdAt), desc(guestBlocklist.id))
    .limit(limit);
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
