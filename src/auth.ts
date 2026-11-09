import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { applyMigrations, type Migration } from "./migrations";

const AUTH_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS api_keys (
  hash TEXT PRIMARY KEY,
  principal TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grants (
  key_hash TEXT NOT NULL,
  venue TEXT NOT NULL,
  PRIMARY KEY (key_hash, venue)
);
`;

const AUTH_MIGRATIONS: Migration[] = [
  { version: 1, sql: AUTH_SCHEMA_V1 },
  {
    version: 2,
    sql: "ALTER TABLE api_keys ADD COLUMN role TEXT NOT NULL DEFAULT 'read'",
  },
];

export type Role = "read" | "write" | "admin";

export type AuthResult =
  | { ok: true; principal: string; role: Role }
  | { ok: false; reason: "unauthorized" | "venue_not_found" };

export type AdminResult =
  | { ok: true; principal: string }
  | { ok: false; reason: "unauthorized" | "forbidden" };

export interface KeyRecord {
  principal: string;
  role: Role;
}

export class Auth extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = this.ctx.storage.sql;
    applyMigrations(this.sql, this.ctx.storage, AUTH_MIGRATIONS);
  }

  async addKey(
    key: string,
    principal: string,
    venues: string[],
    role: Role = "read",
  ): Promise<void> {
    const hash = await sha256Hex(key);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO api_keys (hash, principal, role) VALUES (?, ?, ?) ON CONFLICT(hash) DO NOTHING",
        hash,
        principal,
        role,
      );
      for (const venue of venues) {
        this.sql.exec(
          "INSERT INTO grants (key_hash, venue) VALUES (?, ?) ON CONFLICT DO NOTHING",
          hash,
          venue,
        );
      }
    });
  }

  async authenticate(key: string, venue: string): Promise<AuthResult> {
    const hash = await sha256Hex(key);
    const row = firstRow(
      this.sql.exec<{ principal: string; role: Role }>(
        "SELECT principal, role FROM api_keys WHERE hash = ?",
        hash,
      ),
    );
    if (!row) return { ok: false, reason: "unauthorized" };
    const granted = firstRow(
      this.sql.exec(
        "SELECT 1 AS x FROM grants WHERE (key_hash = ? AND venue = ?) OR (key_hash = ? AND venue = '*')",
        hash,
        venue,
        hash,
      ),
    );
    if (!granted) return { ok: false, reason: "venue_not_found" };
    return { ok: true, principal: row.principal, role: row.role };
  }

  async authenticateAdmin(key: string): Promise<AdminResult> {
    const hash = await sha256Hex(key);
    const row = firstRow(
      this.sql.exec<{ principal: string; role: Role }>(
        "SELECT principal, role FROM api_keys WHERE hash = ?",
        hash,
      ),
    );
    if (!row) return { ok: false, reason: "unauthorized" };
    if (row.role !== "admin") return { ok: false, reason: "forbidden" };
    return { ok: true, principal: row.principal };
  }

  async listKeys(): Promise<KeyRecord[]> {
    return this.sql
      .exec<{ principal: string; role: Role }>(
        "SELECT principal, role FROM api_keys ORDER BY principal",
      )
      .toArray()
      .map((r) => ({ principal: r.principal, role: r.role }));
  }

  async revokeKey(key: string): Promise<void> {
    const hash = await sha256Hex(key);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM grants WHERE key_hash = ?", hash);
      this.sql.exec("DELETE FROM api_keys WHERE hash = ?", hash);
    });
  }
}

function firstRow<T extends Record<string, SqlStorageValue>>(
  cursor: SqlStorageCursor<T>,
): T | undefined {
  return cursor.toArray()[0];
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
