import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { guestBlocklist, venues } from "../src/db/schema";
import {
  blocklistDigests,
  blocklistKeyringFromEnv,
  deleteBlocklistEntry,
  findBlocklistEntries,
  insertBlocklistEntry,
  listBlocklistEntries,
} from "../src/lib/blocklist";
import { blocklistHash, blocklistKey, normalizeContact, type ContactKey } from "../src/lib/contact";

const SECRET = Buffer.alloc(32, 7);
const OTHER_SECRET = Buffer.alloc(32, 9);
const key = blocklistKey(SECRET);
const EMAIL: ContactKey = { kind: "email", value: "eva@example.com" };
const PHONE: ContactKey = { kind: "phone", value: "+34600123456" };

function contact(raw: string): ContactKey {
  const normalized = normalizeContact(raw, "ES");
  if (!normalized) throw new Error(`${raw} does not normalize`);
  return normalized;
}

function adrHash(secret: Buffer, venueId: string, c: ContactKey): string {
  const venueKey = createHmac("sha256", secret).update(`opencovers-blocklist-v1:${venueId}`).digest();
  return createHmac("sha256", venueKey).update(`${c.kind}:${c.value}`).digest("hex");
}

describe("blocklist hashing", () => {
  it("computes the ADR-0018 keyed hash and key id", () => {
    const digest = blocklistHash(key, "venue-a", EMAIL);
    expect(digest).toEqual({
      kind: "email",
      keyId: createHmac("sha256", SECRET).update("opencovers-blocklist-key-id").digest("hex").slice(0, 16),
      hash: adrHash(SECRET, "venue-a", EMAIL),
    });
    expect(digest.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(digest.keyId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic", () => {
    expect(blocklistHash(blocklistKey(Buffer.from(SECRET)), "venue-a", { ...PHONE })).toEqual(
      blocklistHash(key, "venue-a", PHONE),
    );
  });

  it("gives one contact unrelated hashes at two venues", () => {
    expect(blocklistHash(key, "venue-a", EMAIL).hash).not.toBe(blocklistHash(key, "venue-b", EMAIL).hash);
  });

  it("separates an email from a phone with the same value", () => {
    const value = "+34600123456";
    expect(blocklistHash(key, "venue-a", { kind: "email", value }).hash).not.toBe(
      blocklistHash(key, "venue-a", { kind: "phone", value }).hash,
    );
  });

  it("hashes the normalized contact, so two spellings of one contact collide", () => {
    const hash = (raw: string) => blocklistHash(key, "venue-a", contact(raw)).hash;
    expect(hash("  Eva@Example.COM ")).toBe(hash("eva@example.com"));
    expect(hash("600 123 456")).toBe(hash("+34 600 123 456"));
    expect(hash("eva@example.com")).not.toBe(hash("eva+mesa@example.com"));
  });

  it("derives a different key id from a different key", () => {
    expect(blocklistKey(OTHER_SECRET).id).not.toBe(key.id);
    expect(blocklistKey(Buffer.from(SECRET)).id).toBe(key.id);
  });

  it("hashes under the current and the previous key during a rotation", () => {
    const keyring = blocklistKeyringFromEnv({
      BLOCKLIST_KEY: OTHER_SECRET.toString("base64"),
      BLOCKLIST_KEY_PREVIOUS: SECRET.toString("base64"),
    });
    expect(blocklistDigests(keyring, "venue-a", EMAIL)).toEqual([
      blocklistHash(blocklistKey(OTHER_SECRET), "venue-a", EMAIL),
      blocklistHash(key, "venue-a", EMAIL),
    ]);
  });
});

describe("blocklist key from the environment", () => {
  it("falls back to the development key when unset or empty", () => {
    const unset = blocklistKeyringFromEnv({});
    expect(unset.current.id).toMatch(/^[0-9a-f]{16}$/);
    expect(unset.previous).toBeNull();
    expect(blocklistKeyringFromEnv({ BLOCKLIST_KEY: "", BLOCKLIST_KEY_PREVIOUS: "" })).toEqual(unset);
  });

  it("uses the configured key", () => {
    expect(blocklistKeyringFromEnv({ BLOCKLIST_KEY: SECRET.toString("base64") }).current.id).toBe(key.id);
  });

  it.each([
    ["not base64", "not base64 at all!"],
    ["too short", randomBytes(16).toString("base64")],
    ["padded with whitespace", ` ${SECRET.toString("base64")}`],
    ["unpadded", SECRET.toString("base64").replace(/=+$/, "")],
  ])("refuses a key that is %s", (_, value) => {
    expect(() => blocklistKeyringFromEnv({ BLOCKLIST_KEY: value })).toThrow(/BLOCKLIST_KEY/);
    expect(() =>
      blocklistKeyringFromEnv({ BLOCKLIST_KEY: SECRET.toString("base64"), BLOCKLIST_KEY_PREVIOUS: value }),
    ).toThrow(/BLOCKLIST_KEY_PREVIOUS/);
  });
});

describe("guest_blocklist table", () => {
  const A = "bl-venue-a";
  const B = "bl-venue-b";
  const actor = "account-1";

  beforeAll(async () => {
    await migrateDb();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE guest_blocklist, venues RESTART IDENTITY CASCADE`);
    await db.insert(venues).values([
      { id: A, name: "A" },
      { id: B, name: "B" },
    ]);
  });

  it("stores the hash and never the contact", async () => {
    const raws = ["  Eva.Garcia@Example.COM ", "600 123 456"];
    for (const raw of raws) {
      const entry = await insertBlocklistEntry(db, A, blocklistHash(key, A, contact(raw)), {
        reason: "no_show",
        createdBy: actor,
      });
      expect(entry).not.toBeNull();
    }
    const rows = (await db.execute(sql`SELECT * FROM guest_blocklist`)).rows;
    expect(rows).toHaveLength(2);
    const needles = [
      ...raws.map((r) => r.trim().toLowerCase()),
      ...raws.map((r) => contact(r).value),
      "eva.garcia",
      "600123456",
      "600 123 456",
    ];
    for (const row of rows) {
      for (const value of Object.values(row)) {
        const text = String(value instanceof Date ? value.toISOString() : value).toLowerCase();
        for (const needle of needles) expect(text).not.toContain(needle);
      }
    }
    expect(rows.map((r) => r.hash).sort()).toEqual(
      raws.map((r) => adrHash(SECRET, A, contact(r))).sort(),
    );
  });

  it("adds an entry once per venue, key and hash", async () => {
    const digest = blocklistHash(key, A, EMAIL);
    const first = await insertBlocklistEntry(db, A, digest, { reason: null, createdBy: actor });
    expect(first).toMatchObject({ kind: "email", keyId: key.id, reason: null, createdBy: actor });
    expect(await insertBlocklistEntry(db, A, digest, { reason: "conduct", createdBy: "account-2" })).toBeNull();
    expect(await insertBlocklistEntry(db, B, digest, { reason: null, createdBy: actor })).not.toBeNull();
    const rows = await db.select().from(guestBlocklist).where(eq(guestBlocklist.venueId, A));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBeNull();
  });

  it("finds an entry made under the previous key after a rotation", async () => {
    const old = await insertBlocklistEntry(db, A, blocklistHash(key, A, PHONE), { reason: null, createdBy: actor });
    const rotated = blocklistKeyringFromEnv({
      BLOCKLIST_KEY: OTHER_SECRET.toString("base64"),
      BLOCKLIST_KEY_PREVIOUS: SECRET.toString("base64"),
    });
    expect(await findBlocklistEntries(db, A, blocklistDigests(rotated, A, PHONE))).toEqual([old]);
    const withoutPrevious = blocklistKeyringFromEnv({ BLOCKLIST_KEY: OTHER_SECRET.toString("base64") });
    expect(await findBlocklistEntries(db, A, blocklistDigests(withoutPrevious, A, PHONE))).toEqual([]);
  });

  it("finds only the matching contact", async () => {
    const eva = await insertBlocklistEntry(db, A, blocklistHash(key, A, EMAIL), { reason: null, createdBy: actor });
    await insertBlocklistEntry(db, A, blocklistHash(key, A, PHONE), { reason: null, createdBy: actor });
    expect(await findBlocklistEntries(db, A, [blocklistHash(key, A, contact("EVA@example.com"))])).toEqual([eva]);
    expect(await findBlocklistEntries(db, A, [blocklistHash(key, A, contact("ana@example.com"))])).toEqual([]);
    expect(await findBlocklistEntries(db, A, [])).toEqual([]);
  });

  it("keeps each venue's entries to that venue", async () => {
    const digestA = blocklistHash(key, A, EMAIL);
    const entry = await insertBlocklistEntry(db, A, digestA, { reason: "other", createdBy: actor });
    if (!entry) throw new Error("not inserted");

    expect(await findBlocklistEntries(db, B, [digestA])).toEqual([]);
    expect(await findBlocklistEntries(db, B, [blocklistHash(key, B, EMAIL)])).toEqual([]);
    expect(await listBlocklistEntries(db, B, 50)).toEqual([]);
    expect(await deleteBlocklistEntry(db, B, entry.id)).toBeNull();
    expect(await listBlocklistEntries(db, A, 50)).toEqual([entry]);

    expect(await deleteBlocklistEntry(db, A, entry.id)).toEqual(entry);
    expect(await deleteBlocklistEntry(db, A, entry.id)).toBeNull();
    expect(await listBlocklistEntries(db, A, 50)).toEqual([]);
  });

  it("lists newest first, up to the limit", async () => {
    const ids: string[] = [];
    for (const [i, raw] of ["a@example.com", "b@example.com", "c@example.com"].entries()) {
      const entry = await insertBlocklistEntry(db, A, blocklistHash(key, A, contact(raw)), {
        reason: null,
        createdBy: actor,
      });
      if (!entry) throw new Error("not inserted");
      await db
        .update(guestBlocklist)
        .set({ createdAt: new Date(Date.UTC(2026, 0, 1 + i)) })
        .where(eq(guestBlocklist.id, entry.id));
      ids.push(entry.id);
    }
    expect((await listBlocklistEntries(db, A, 2)).map((e) => e.id)).toEqual([ids[2], ids[1]]);
  });

  it("goes with its venue", async () => {
    await insertBlocklistEntry(db, A, blocklistHash(key, A, EMAIL), { reason: null, createdBy: actor });
    await db.delete(venues).where(eq(venues.id, A));
    expect(await db.select().from(guestBlocklist)).toEqual([]);
  });

  describe("checks", () => {
    const valid = () => ({
      id: randomUUID(),
      venueId: A,
      kind: "email",
      keyId: key.id,
      hash: adrHash(SECRET, A, EMAIL),
      reason: "no_show",
      createdBy: actor,
    });

    async function violation(row: Record<string, unknown>): Promise<string | undefined> {
      try {
        await db.insert(guestBlocklist).values(row as typeof guestBlocklist.$inferInsert);
      } catch (e) {
        const err = e as { constraint?: string; cause?: { constraint?: string } };
        return err.cause?.constraint ?? err.constraint ?? "unknown";
      }
      return undefined;
    }

    it("accepts every reason code and no reason", async () => {
      for (const reason of ["no_show", "late_cancellation", "conduct", "other", null]) {
        expect(await violation({ ...valid(), reason, hash: randomBytes(32).toString("hex") })).toBeUndefined();
      }
      expect(await violation({ ...valid(), kind: "phone" })).toBeUndefined();
    });

    it.each([
      ["kind", { kind: "name" }, "guest_blocklist_kind"],
      ["reason", { reason: "thief" }, "guest_blocklist_reason"],
      ["reason as free text", { reason: "threw a glass at staff" }, "guest_blocklist_reason"],
      ["hash holding a contact", { hash: "eva@example.com" }, "guest_blocklist_hash"],
      ["hash in upper case", { hash: adrHash(SECRET, A, EMAIL).toUpperCase() }, "guest_blocklist_hash"],
      ["key id", { keyId: "not-a-key-id" }, "guest_blocklist_key_id"],
    ])("rejects a bad %s", async (_, override, constraint) => {
      expect(await violation({ ...valid(), ...override })).toBe(constraint);
    });
  });
});
