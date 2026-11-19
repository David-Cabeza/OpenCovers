// Builds a visitor's sandbox restaurant (ADR-0022, decisions 1, 2 and 4). It calls the same domain functions the
// routes call, in this process, from the template in ./template.ts. One sandbox per account: a second call returns
// the first.
import { eq, sql } from "drizzle-orm";
import { demoSandboxes, user } from "../db/schema";
import { addFloorItem } from "../lib/floor-items";
import { createInvitation } from "../lib/invitations";
import { getOnlineBooking, parseOnlineBookingInput, setOnlineBooking } from "../lib/online-booking";
import { parseProfileInput, setProfile } from "../lib/public-profile";
import {
  cancelReservation,
  createReservation,
  modifyReservation,
  setStatus,
  walkIn,
  type WriteResult,
} from "../lib/reservations";
import { upsertService, upsertTable, updateTableLayout } from "../lib/catalog";
import { addWaitlist } from "../lib/waitlist";
import { createVenue, setConfig, type Db } from "../lib/venue";
import { admissionFor, DemoRefusal } from "./admission";
import { normalizeEmail } from "./normalize";
import { sandboxLimits } from "./settings";
import {
  DEMO_TEMPLATE,
  planReservations,
  settle,
  templateServices,
  timeInTz,
  type DemoTemplate,
} from "./template";

export interface Sandbox {
  venueId: string;
  bookingKey: string | null;
  /** False when the account already had its sandbox. */
  created: boolean;
}

export interface ProvisionOptions {
  template?: DemoTemplate;
  now?: Date;
  /** `https` origin of the demo host. It becomes the only allowed origin of the sandbox's widget. */
  origin?: string | null;
}

function must<T extends { ok: boolean }>(result: T, what: string): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`demo sandbox: ${what} failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

function demoOrigin(): string | null {
  try {
    const url = new URL(process.env.BETTER_AUTH_URL ?? "");
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Builds at most `provisionConcurrency` sandboxes at a time and queues the rest, so builds never starve the pool. */
const slots = { active: 0, waiting: [] as (() => void)[] };

async function inSlot<T>(run: () => Promise<T>): Promise<T> {
  const limits = sandboxLimits();
  if (slots.active >= limits.provisionConcurrency) {
    if (slots.waiting.length >= limits.provisionQueue) throw new DemoRefusal("busy");
    // The finishing build hands its slot straight to the next waiter, so `active` does not change.
    await new Promise<void>((resolve) => slots.waiting.push(resolve));
  } else {
    slots.active += 1;
  }
  try {
    return await run();
  } finally {
    const next = slots.waiting.shift();
    if (next) next();
    else slots.active -= 1;
  }
}

async function existingSandbox(db: Db, userId: string): Promise<Sandbox | null> {
  const existing = (await db.select().from(demoSandboxes).where(eq(demoSandboxes.userId, userId)).limit(1))[0];
  if (!existing) return null;
  await db.update(demoSandboxes).set({ lastSignInAt: new Date() }).where(eq(demoSandboxes.userId, userId));
  const settings = await getOnlineBooking(db, existing.venueId);
  return { venueId: existing.venueId, bookingKey: settings?.bookingKey ?? null, created: false };
}

/**
 * Gives `userId` a sandbox, or returns the one they have and extends its life by touching `last_sign_in_at`.
 *
 * The whole build (venue, admin membership, template, and the `demo_sandbox` row that marks it) runs on ONE
 * transaction, so it holds one pool connection and never waits for a second (audit F1), and an interrupted build
 * leaves nothing behind: no unmarked venue (audit F5). The domain functions get the transaction as their `Db`, and
 * their own transactions become savepoints. Throws `DemoRefusal` when the demo is full or the address has a sandbox.
 */
export async function provisionSandbox(db: Db, userId: string, options: ProvisionOptions = {}): Promise<Sandbox> {
  const returning = await existingSandbox(db, userId);
  if (returning) return returning;
  return inSlot(() =>
    db.transaction(async (guard) => {
      const tx = guard as unknown as Db;
      // One provisioner per account at a time.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`demo-sandbox:${userId}`}, 0))`);
      const again = await existingSandbox(tx, userId);
      if (again) return again;

      const owner = (await tx.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1))[0];
      if (!owner) throw new Error(`demo sandbox: no account ${userId}`);
      const normalized = normalizeEmail(owner.email);
      if (normalized === null) throw new DemoRefusal("invalid_address");
      // Cheap early refusal, so a full demo does not pay for a build. The authoritative check is below, under the lock.
      const early = await admissionFor(tx, normalized, userId);
      if (early) throw new DemoRefusal(early);

      const template = options.template ?? DEMO_TEMPLATE;
      const { id: venueId } = await createVenue(tx, userId, template.venue);
      const bookingKey = await build(tx, venueId, userId, owner.email, template, options);

      // Counting live sandboxes is only exact while no other build commits in between: one global lock, held only
      // from here to the commit. The unique indexes on user_id and normalized_email are the last line.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('demo-admission', 0))`);
      const final = await admissionFor(tx, normalized, userId);
      if (final) throw new DemoRefusal(final);
      await tx.insert(demoSandboxes).values({ userId, venueId, normalizedEmail: normalized });
      return { venueId, bookingKey, created: true };
    }),
  );
}

async function build(
  db: Db,
  venueId: string,
  userId: string,
  ownerEmail: string,
  template: DemoTemplate,
  options: ProvisionOptions,
): Promise<string | null> {
  const now = options.now ?? new Date();
  const tz = template.venue.timezone;

  for (const service of templateServices(template, false)) {
    must(await upsertService(db, venueId, service), `service ${service.name}`);
  }
  for (const t of template.tables) {
    await upsertTable(db, venueId, { id: t.id, name: t.name, seats: t.seats, zone: t.zone, shape: t.shape });
    await updateTableLayout(db, venueId, t.id, { x: t.x, y: t.y, rotation: 0 });
  }
  for (const item of template.floorItems) await addFloorItem(db, venueId, item);

  // Email goes only to the owner (see limits.ts mayEmail), so notices are on and point at the owner's address.
  must(
    await setConfig(db, venueId, {
      ...template.config,
      enabled: true,
      noticeAddress: ownerEmail,
      notificationsEnabled: true,
    }),
    "config",
  );

  const profile = parseProfileInput(template.publicProfile);
  if (!profile) throw new Error("demo sandbox: the template's public profile is invalid");
  must(await setProfile(db, venueId, profile), "public profile");

  const origin = options.origin === undefined ? demoOrigin() : options.origin;
  const booking = parseOnlineBookingInput({
    ...template.onlineBooking,
    ...(origin ? { allowedOrigins: [origin] } : {}),
  });
  if (!booking) throw new Error("demo sandbox: the template's online booking is invalid");
  const online = must(await setOnlineBooking(db, venueId, booking), "online booking");

  const plan = planReservations(template, now);
  const created: { id: string; day: number; time: string; partySize: number }[] = [];
  for (const [n, p] of plan.entries()) {
    const result: WriteResult = await createReservation(
      db,
      venueId,
      {
        date: p.date,
        time: p.time,
        partySize: p.partySize,
        guestName: p.guestName,
        guestContact: p.contact,
        consent: "granted",
        commentary: p.commentary,
        bookedVia: ownerEmail,
        basis: "service",
        ownerPrincipal: ownerEmail,
      },
      `demo-${venueId}-create-${n}`,
    );
    // A slot the engine refuses (a service is not open at that time of day) is skipped, as the HTTP seed does.
    if (result.ok) created.push({ id: result.id, day: p.day, time: p.time, partySize: p.partySize });
  }

  for (const [n, s] of settle(created, timeInTz(tz, now)).entries()) {
    const res = created[s.index]!;
    const key = `demo-${venueId}-settle-${n}`;
    if (s.action === "cancel") await cancelReservation(db, venueId, res.id, key, null);
    else if (s.action === "modify") await modifyReservation(db, venueId, res.id, { partySize: s.partySize }, key);
    else await setStatus(db, venueId, res.id, s.action, key, null);
  }

  for (const w of template.waitlist) {
    must(
      await addWaitlist(db, venueId, { partySize: w.partySize, guestName: w.name, guestContact: `${w.local}@example.com` }),
      "waitlist",
    );
  }
  // Only works while a service is open. Not an error otherwise.
  await walkIn(
    db,
    venueId,
    {
      partySize: template.walkIn.partySize,
      guestName: template.walkIn.name,
      bookedVia: ownerEmail,
      basis: "service",
      ownerPrincipal: ownerEmail,
    },
    `demo-${venueId}-walk-in`,
  );
  await createInvitation(db, venueId, userId, template.pendingInvitation);

  return online.settings.bookingKey;
}
