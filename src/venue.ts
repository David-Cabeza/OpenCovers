import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { MIGRATIONS } from "./schema";
import { applyMigrations } from "./migrations";
import { toEpoch } from "./time";

export interface CreateReservationInput {
  date: string;
  time: string;
  durationMinutes: number;
  partySize: number;
  tableIds: string[];
  guestName?: string;
  guestContact?: string;
  bookedVia?: string;
  basis?: string;
  ownerPrincipal?: string;
}

export interface ModifyReservationInput {
  partySize?: number;
  tableIds?: string[];
}

export interface Reservation {
  id: string;
  date: string;
  time: string;
  service: string;
  partySize: number;
  status: string;
  version: number;
  bookedVia: string;
  basis: string;
  ownerPrincipal: string;
  guestName: string;
  guestContact: string;
}

export interface Event {
  id: number;
  type: string;
  reservationId: string;
  version: number;
  tombstoneHash?: string;
  occurredAt: string;
}

export interface VenueConfig {
  enabled: boolean;
  noticeAddress: string;
}

export interface SetConfigInput {
  enabled?: boolean;
  noticeAddress?: string;
}

export interface AvailabilitySlot {
  time: string;
  available: boolean;
  type: string;
}

export type ConfigResult =
  | { ok: true; config: VenueConfig }
  | { ok: false; code: "notice_address_required" };

export interface ErasureResult {
  erasedReservations: number;
  erasedGuests: number;
}

export type StatusTransition = "seated" | "attended" | "no_show";

export type WriteErrorCode =
  | "slot_taken"
  | "invalid_transition"
  | "reservation_not_found"
  | "already_cancelled"
  | "invalid_request"
  | "party_size_too_large"
  | "outside_hours";

export type WriteResult =
  | { ok: true; id: string; version: number }
  | { ok: false; code: WriteErrorCode };

export type CancelResult =
  | { ok: true; hash: string }
  | {
      ok: false;
      code: "reservation_not_found" | "already_cancelled" | "invalid_request";
    };

const ACTIVE_STATUSES = ["booked", "seated"] as const;

const ALLOWED_TRANSITIONS: Record<StatusTransition, string[]> = {
  seated: ["booked"],
  attended: ["seated"],
  no_show: ["booked"],
};

type ReservationRow = {
  id: string;
  date: string;
  time: string;
  service: string;
  party_size: number;
  status: string;
  version: number;
  booked_via: string;
  basis: string;
  owner_principal: string;
  guest_name: string;
  guest_contact: string;
};

const RESERVATION_COLUMNS =
  "id, date, time, service, party_size, status, version, booked_via, basis, owner_principal, guest_name, guest_contact";

class ReservationError extends Error {
  constructor(
    readonly code:
      | "reservation_not_found"
      | "invalid_transition"
      | "already_cancelled"
      | "invalid_request"
      | "notice_address_required",
  ) {
    super(code);
  }
}

export class Venue extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = this.ctx.storage.sql;
    applyMigrations(this.sql, this.ctx.storage, MIGRATIONS);
    this.ctx.waitUntil(this.ensureAlarm());
  }

  private async ensureAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null) {
      await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
    }
  }

  async alarm(): Promise<void> {
    this.prune();
    await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
  }

  private prune(): void {
    const retention = this.sql
      .exec<{ retention_days: number }>(
        "SELECT retention_days FROM config WHERE id = 1",
      )
      .one();
    const cutoff =
      Math.floor(Date.now() / 1000) - retention.retention_days * 86400;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM events WHERE occurred_at < ?", cutoff);
      this.sql.exec("DELETE FROM tombstones WHERE created_at < ?", cutoff);
    });
  }

  async health(): Promise<{ ok: boolean }> {
    const row = this.sql.exec("SELECT 1 AS ok").one();
    return { ok: row.ok === 1 };
  }

  async getConfig(): Promise<VenueConfig> {
    const row = this.sql
      .exec<{ enabled: number; notice_address: string }>(
        "SELECT enabled, notice_address FROM config WHERE id = 1",
      )
      .one();
    return { enabled: row.enabled === 1, noticeAddress: row.notice_address };
  }

  async setConfig(input: SetConfigInput): Promise<ConfigResult> {
    try {
      const config = this.ctx.storage.transactionSync(() => {
        const current = this.sql
          .exec<{ enabled: number; notice_address: string }>(
            "SELECT enabled, notice_address FROM config WHERE id = 1",
          )
          .one();
        const enabled = input.enabled ?? current.enabled === 1;
        const noticeAddress =
          input.noticeAddress !== undefined ? input.noticeAddress : current.notice_address;
        if (enabled && noticeAddress === "") {
          throw new ReservationError("notice_address_required");
        }
        this.sql.exec(
          "UPDATE config SET enabled = ?, notice_address = ? WHERE id = 1",
          enabled ? 1 : 0,
          noticeAddress,
        );
        return { enabled, noticeAddress };
      });
      return { ok: true, config };
    } catch (error) {
      if (error instanceof ReservationError) {
        return { ok: false, code: error.code as "notice_address_required" };
      }
      throw error;
    }
  }

  async getAvailability(
    date: string,
    partySize: number,
  ): Promise<Record<string, AvailabilitySlot[]>> {
    const cfg = this.sql
      .exec<{ timezone: string; slot_interval_minutes: number }>(
        "SELECT timezone, slot_interval_minutes FROM config WHERE id = 1",
      )
      .one();
    const services = this.sql
      .exec<{ name: string; open_start: string; open_end: string }>(
        "SELECT name, open_start, open_end FROM services",
      )
      .toArray();
    const result: Record<string, AvailabilitySlot[]> = {};
    for (const service of services) {
      const closeEpoch = toEpoch(date, service.open_end, cfg.timezone);
      const slots: AvailabilitySlot[] = [];
      for (const time of generateSlots(
        service.open_start,
        service.open_end,
        cfg.slot_interval_minutes,
      )) {
        const start = toEpoch(date, time, cfg.timezone);
        const end = start + DEFAULT_DURATION_SECONDS;
        if (end > closeEpoch) continue;
        slots.push({
          time,
          available: this.hasFreeTable(start, end, partySize),
          type: "free",
        });
      }
      result[service.name] = slots;
    }
    return result;
  }

  async erase(guestId?: string, principal?: string): Promise<ErasureResult> {
    const matches = guestId
      ? this.sql
          .exec<{ id: string; version: number }>(
            "SELECT id, version FROM reservations WHERE guest_contact = ? AND erased = 0",
            guestId,
          )
          .toArray()
      : principal
        ? this.sql
            .exec<{ id: string; version: number }>(
              "SELECT id, version FROM reservations WHERE owner_principal = ? AND erased = 0",
              principal,
            )
            .toArray()
        : [];
    const now = Math.floor(Date.now() / 1000);
    const hashes: string[] = [];
    for (const m of matches) hashes.push(await sha256Hex(m.id));
    this.ctx.storage.transactionSync(() => {
      for (let i = 0; i < matches.length; i++) {
        const id = matches[i].id;
        this.sql.exec(
          "UPDATE reservations SET guest_name = '', guest_contact = '', erased = 1 WHERE id = ?",
          id,
        );
        this.sql.exec(
          "INSERT INTO tombstones (reservation_id, hash, created_at) VALUES (?, ?, ?)",
          id,
          hashes[i],
          now,
        );
        this.sql.exec(
          "INSERT INTO events (type, reservation_id, version, tombstone_hash, occurred_at) VALUES ('erased', ?, ?, ?, ?)",
          id,
          matches[i].version,
          hashes[i],
          now,
        );
      }
    });
    return {
      erasedReservations: matches.length,
      erasedGuests: matches.length > 0 ? 1 : 0,
    };
  }

  private hasFreeTable(start: number, end: number, partySize: number): boolean {
    const tables = this.sql
      .exec<{ id: string }>("SELECT id FROM tables WHERE seats >= ?", partySize)
      .toArray();
    for (const t of tables) {
      const busy = firstRow(
        this.sql.exec(
          "SELECT 1 AS x FROM table_allocations a JOIN reservations r ON r.id = a.reservation_id WHERE a.table_id = ? AND r.status IN ('booked', 'seated') AND a.start_epoch < ? AND ? < a.end_epoch",
          t.id,
          end,
          start,
        ),
      );
      if (!busy) return true;
    }
    return false;
  }

  private totalSeats(tableIds: string[]): number {
    if (tableIds.length === 0) return 0;
    const placeholders = tableIds.map(() => "?").join(", ");
    const row = this.sql
      .exec<{ total: number }>(
        `SELECT COALESCE(SUM(seats), 0) AS total FROM tables WHERE id IN (${placeholders})`,
        ...tableIds,
      )
      .one();
    return row.total;
  }

  private deriveService(time: string): string {
    const minute = toMinutes(time);
    const services = this.sql
      .exec<{ name: string; open_start: string; open_end: string }>(
        "SELECT name, open_start, open_end FROM services",
      )
      .toArray();
    for (const service of services) {
      if (
        minute >= toMinutes(service.open_start) &&
        minute < toMinutes(service.open_end)
      ) {
        return service.name;
      }
    }
    return "";
  }

  async createReservation(
    input: CreateReservationInput,
    key: string,
  ): Promise<WriteResult> {
    const id = crypto.randomUUID();
    const timezone = this.sql
      .exec<{ timezone: string }>("SELECT timezone FROM config WHERE id = 1")
      .one().timezone;
    const start = toEpoch(input.date, input.time, timezone);
    const end = start + input.durationMinutes * 60;
    const now = Math.floor(Date.now() / 1000);
    if (input.partySize > this.totalSeats(input.tableIds)) {
      return { ok: false, code: "party_size_too_large" };
    }
    const service = this.deriveService(input.time);
    if (service === "") return { ok: false, code: "outside_hours" };
    try {
      const result = this.ctx.storage.transactionSync(() => {
        const existing = firstRow(
          this.sql.exec<{ reservation_id: string; kind: string; version: number }>(
            "SELECT reservation_id, kind, version FROM idempotency_keys WHERE key = ?",
            key,
          ),
        );
        if (existing) {
          if (existing.kind !== "create") throw new ReservationError("invalid_request");
          return { id: existing.reservation_id, version: existing.version };
        }
        this.sql.exec(
          "INSERT INTO reservations (id, date, time, service, start_epoch, end_epoch, party_size, status, version, booked_via, basis, owner_principal, guest_name, guest_contact, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          id,
          input.date,
          input.time,
          service,
          start,
          end,
          input.partySize,
          "booked",
          1,
          input.bookedVia ?? "",
          input.basis ?? "",
          input.ownerPrincipal ?? "",
          input.guestName ?? "",
          input.guestContact ?? "",
          now,
        );
        for (const tableId of input.tableIds) {
          this.sql.exec(
            "INSERT INTO table_allocations (reservation_id, table_id, start_epoch, end_epoch) VALUES (?, ?, ?, ?)",
            id,
            tableId,
            start,
            end,
          );
        }
        this.sql.exec(
          "INSERT INTO idempotency_keys (key, reservation_id, kind, version) VALUES (?, ?, ?, ?)",
          key,
          id,
          "create",
          1,
        );
        this.sql.exec(
          "INSERT INTO events (type, reservation_id, version, occurred_at) VALUES ('created', ?, ?, ?)",
          id,
          1,
          now,
        );
        return { id, version: 1 };
      });
      return { ok: true, id: result.id, version: result.version };
    } catch (error) {
      if (isSlotTaken(error)) return { ok: false, code: "slot_taken" };
      throw error;
    }
  }

  async modifyReservation(
    id: string,
    input: ModifyReservationInput,
    key: string,
  ): Promise<WriteResult> {
    try {
      const version = this.ctx.storage.transactionSync(() => {
        const existing = firstRow(
          this.sql.exec<{ reservation_id: string; kind: string; version: number }>(
            "SELECT reservation_id, kind, version FROM idempotency_keys WHERE key = ?",
            key,
          ),
        );
        if (existing) {
          if (existing.kind !== "modify" || existing.reservation_id !== id) {
            throw new ReservationError("invalid_request");
          }
          return existing.version;
        }
        const current = firstRow(
          this.sql.exec<{
            version: number;
            status: string;
            start_epoch: number;
            end_epoch: number;
          }>(
            "SELECT version, status, start_epoch, end_epoch FROM reservations WHERE id = ?",
            id,
          ),
        );
        if (!current) throw new ReservationError("reservation_not_found");
        if (
          !ACTIVE_STATUSES.includes(current.status as (typeof ACTIVE_STATUSES)[number])
        ) {
          throw new ReservationError("invalid_transition");
        }
        const nextVersion = current.version + 1;
        if (input.partySize !== undefined) {
          this.sql.exec(
            "UPDATE reservations SET party_size = ?, version = ? WHERE id = ?",
            input.partySize,
            nextVersion,
            id,
          );
        } else {
          this.sql.exec(
            "UPDATE reservations SET version = ? WHERE id = ?",
            nextVersion,
            id,
          );
        }
        if (input.tableIds !== undefined) {
          this.sql.exec("DELETE FROM table_allocations WHERE reservation_id = ?", id);
          for (const tableId of input.tableIds) {
            this.sql.exec(
              "INSERT INTO table_allocations (reservation_id, table_id, start_epoch, end_epoch) VALUES (?, ?, ?, ?)",
              id,
              tableId,
              current.start_epoch,
              current.end_epoch,
            );
          }
        }
        this.sql.exec(
          "INSERT INTO idempotency_keys (key, reservation_id, kind, version) VALUES (?, ?, ?, ?)",
          key,
          id,
          "modify",
          nextVersion,
        );
        this.sql.exec(
          "INSERT INTO events (type, reservation_id, version, occurred_at) VALUES ('modified', ?, ?, ?)",
          id,
          nextVersion,
          Math.floor(Date.now() / 1000),
        );
        return nextVersion;
      });
      return { ok: true, id, version };
    } catch (error) {
      if (error instanceof ReservationError) {
        return { ok: false, code: error.code as WriteErrorCode };
      }
      if (isSlotTaken(error)) return { ok: false, code: "slot_taken" };
      throw error;
    }
  }

  async cancelReservation(id: string, key: string): Promise<CancelResult> {
    const hash = await sha256Hex(id);
    const now = Math.floor(Date.now() / 1000);
    try {
      this.ctx.storage.transactionSync(() => {
        const existing = firstRow(
          this.sql.exec<{ reservation_id: string; kind: string }>(
            "SELECT reservation_id, kind FROM idempotency_keys WHERE key = ?",
            key,
          ),
        );
        if (existing) {
          if (existing.kind !== "cancel" || existing.reservation_id !== id) {
            throw new ReservationError("invalid_request");
          }
          return;
        }
        const current = firstRow(
          this.sql.exec<{ status: string; version: number }>(
            "SELECT status, version FROM reservations WHERE id = ?",
            id,
          ),
        );
        if (!current) throw new ReservationError("reservation_not_found");
        if (current.status === "cancelled") {
          throw new ReservationError("already_cancelled");
        }
        const nextVersion = current.version + 1;
        this.sql.exec(
          "UPDATE reservations SET status = 'cancelled', version = ? WHERE id = ?",
          nextVersion,
          id,
        );
        this.sql.exec("DELETE FROM table_allocations WHERE reservation_id = ?", id);
        this.sql.exec(
          "INSERT INTO tombstones (reservation_id, hash, created_at) VALUES (?, ?, ?)",
          id,
          hash,
          now,
        );
        this.sql.exec(
          "INSERT INTO idempotency_keys (key, reservation_id, kind, version) VALUES (?, ?, ?, ?)",
          key,
          id,
          "cancel",
          nextVersion,
        );
        this.sql.exec(
          "INSERT INTO events (type, reservation_id, version, occurred_at) VALUES ('cancelled', ?, ?, ?)",
          id,
          nextVersion,
          now,
        );
      });
      return { ok: true, hash };
    } catch (error) {
      if (error instanceof ReservationError) {
        return {
          ok: false,
          code: error.code as
            | "reservation_not_found"
            | "already_cancelled"
            | "invalid_request",
        };
      }
      throw error;
    }
  }

  async setStatus(
    id: string,
    status: StatusTransition,
    key: string,
  ): Promise<WriteResult> {
    try {
      const version = this.ctx.storage.transactionSync(() => {
        const existing = firstRow(
          this.sql.exec<{ reservation_id: string; kind: string; version: number }>(
            "SELECT reservation_id, kind, version FROM idempotency_keys WHERE key = ?",
            key,
          ),
        );
        if (existing) {
          if (existing.kind !== "status" || existing.reservation_id !== id) {
            throw new ReservationError("invalid_request");
          }
          return existing.version;
        }
        const current = firstRow(
          this.sql.exec<{ status: string; version: number }>(
            "SELECT status, version FROM reservations WHERE id = ?",
            id,
          ),
        );
        if (!current) throw new ReservationError("reservation_not_found");
        const allowed = ALLOWED_TRANSITIONS[status];
        if (!allowed || !allowed.includes(current.status)) {
          throw new ReservationError("invalid_transition");
        }
        const nextVersion = current.version + 1;
        this.sql.exec(
          "UPDATE reservations SET status = ?, version = ? WHERE id = ?",
          status,
          nextVersion,
          id,
        );
        this.sql.exec(
          "INSERT INTO idempotency_keys (key, reservation_id, kind, version) VALUES (?, ?, ?, ?)",
          key,
          id,
          "status",
          nextVersion,
        );
        this.sql.exec(
          "INSERT INTO events (type, reservation_id, version, occurred_at) VALUES (?, ?, ?, ?)",
          status,
          id,
          nextVersion,
          Math.floor(Date.now() / 1000),
        );
        return nextVersion;
      });
      return { ok: true, id, version };
    } catch (error) {
      if (error instanceof ReservationError) {
        return { ok: false, code: error.code as WriteErrorCode };
      }
      throw error;
    }
  }

  async getReservation(id: string): Promise<Reservation | null> {
    const row = firstRow(
      this.sql.exec<ReservationRow>(
        `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE id = ?`,
        id,
      ),
    );
    if (!row) return null;
    return toReservation(row);
  }

  async listByDate(date: string): Promise<Reservation[]> {
    const rows = this.sql
      .exec<ReservationRow>(
        `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE date = ? ORDER BY start_epoch`,
        date,
      )
      .toArray();
    return rows.map(toReservation);
  }

  async searchReservations(
    dateStart: string,
    dateEnd: string,
    statuses?: string[],
  ): Promise<Reservation[]> {
    if (statuses && statuses.length > 0) {
      const placeholders = statuses.map(() => "?").join(", ");
      const rows = this.sql
        .exec<ReservationRow>(
          `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE date >= ? AND date <= ? AND status IN (${placeholders}) ORDER BY start_epoch`,
          dateStart,
          dateEnd,
          ...statuses,
        )
        .toArray();
      return rows.map(toReservation);
    }
    const rows = this.sql
      .exec<ReservationRow>(
        `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE date >= ? AND date <= ? ORDER BY start_epoch`,
        dateStart,
        dateEnd,
      )
      .toArray();
    return rows.map(toReservation);
  }

  async getEvents(
    afterId: number,
    limit: number,
  ): Promise<{ ok: true; events: Event[] } | { ok: false; code: "expired_cursor" }> {
    if (afterId > 0) {
      const retention = this.sql
        .exec<{ retention_days: number }>(
          "SELECT retention_days FROM config WHERE id = 1",
        )
        .one();
      const cutoff =
        Math.floor(Date.now() / 1000) - retention.retention_days * 86400;
      const oldest = firstRow(
        this.sql.exec<{ id: number }>(
          "SELECT MIN(id) AS id FROM events WHERE occurred_at >= ?",
          cutoff,
        ),
      );
      const oldestId = oldest?.id ?? null;
      if (oldestId === null || afterId < oldestId) {
        return { ok: false, code: "expired_cursor" };
      }
    }
    const rows = this.sql
      .exec<{
        id: number;
        type: string;
        reservation_id: string;
        version: number;
        tombstone_hash: string | null;
        occurred_at: number;
      }>(
        "SELECT id, type, reservation_id, version, tombstone_hash, occurred_at FROM events WHERE id > ? ORDER BY id LIMIT ?",
        afterId,
        limit,
      )
      .toArray();
    return {
      ok: true,
      events: rows.map((r) => ({
        id: r.id,
        type: r.type,
        reservationId: r.reservation_id,
        version: r.version,
        tombstoneHash: r.tombstone_hash ?? undefined,
        occurredAt: new Date(r.occurred_at * 1000).toISOString(),
      })),
    };
  }
}

function toReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    service: row.service,
    partySize: row.party_size,
    status: row.status,
    version: row.version,
    bookedVia: row.booked_via,
    basis: row.basis,
    ownerPrincipal: row.owner_principal,
    guestName: row.guest_name,
    guestContact: row.guest_contact,
  };
}

function firstRow<T extends Record<string, SqlStorageValue>>(
  cursor: SqlStorageCursor<T>,
): T | undefined {
  return cursor.toArray()[0];
}

const DEFAULT_DURATION_SECONDS = 120 * 60;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function generateSlots(
  openStart: string,
  openEnd: string,
  intervalMinutes: number,
): string[] {
  const start = toMinutes(openStart);
  const end = toMinutes(openEnd);
  const slots: string[] = [];
  for (let m = start; m < end; m += intervalMinutes) {
    slots.push(toTime(m));
  }
  return slots;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function toTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isSlotTaken(error: unknown): boolean {
  return error instanceof Error && error.message.includes("slot_taken");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
