#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { request } from "./client.js";
import { type ToolResult, fail } from "./fail.js";

const VERSION = "0.1.0";

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const consentSchema = z
  .enum(["unknown", "granted", "denied"])
  .optional()
  .describe("Whether the guest allows being contacted after the visit. Omit if never asked.");

const ratingSchema = z
  .number()
  .int()
  .min(1)
  .max(5)
  .nullable()
  .optional()
  .describe("The guest's rating of the visit, 1 to 5. Omit if not given. Null clears it.");

const reconfirmationSchema = z
  .enum(["none", "requested", "confirmed", "declined", "no_answer"])
  .optional()
  .describe(
    "Whether the guest reconfirmed the booking. none means not asked, requested means asked and waiting. Omit to leave it unchanged. A booking is never cancelled by it.",
  );

const commentarySchema = z
  .string()
  .max(500)
  .optional()
  .describe(
    "A short note for staff about this booking, up to 500 characters, such as an occasion. Never put allergies, medical conditions, or diet needs here. Empty string clears it.",
  );

const idempotencyKey = (key?: string) => key ?? crypto.randomUUID();

export function createServer(): McpServer {
  const server = new McpServer({ name: "opencovers", version: VERSION });

  server.registerTool(
    "reservation.availability",
    {
      title: "Availability",
      description:
        "List available time slots for a venue on a date for a party size, grouped by service (meal period).",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string().describe("The venue id."),
        date: z.string().describe("Date as YYYY-MM-DD."),
        partySize: z.number().int().positive().describe("Number of guests."),
      }),
    },
    async ({ venueId, date, partySize }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/availability`, {
            query: { date, partySize },
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "reservation.agenda",
    {
      title: "Agenda",
      description: "List reservations for a venue on a specific date.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        date: z.string().describe("Date as YYYY-MM-DD."),
      }),
    },
    async ({ venueId, date }) => {
      try {
        return ok(await request(`/v1/venues/${venueId}/agenda`, { query: { date } }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "reservation.list",
    {
      title: "List reservations",
      description: "List all reservations for a venue.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ venueId: z.string() }),
    },
    async ({ venueId }) => {
      try {
        return ok(await request(`/v1/venues/${venueId}/reservations`));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "reservation.search",
    {
      title: "Search reservations",
      description: "Search reservations for a venue within a date range, optionally filtered by status.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        dateStart: z.string().describe("Inclusive start date as YYYY-MM-DD."),
        dateEnd: z.string().describe("Exclusive end date as YYYY-MM-DD."),
        status: z
          .array(z.enum(["booked", "seated", "attended", "no_show", "cancelled"]))
          .optional(),
      }),
    },
    async ({ venueId, dateStart, dateEnd, status }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/reservations/search`, {
            query: { dateStart, dateEnd, status },
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "reservation.get",
    {
      title: "Get reservation",
      description: "Get a single reservation by id.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ venueId: z.string(), id: z.string() }),
    },
    async ({ venueId, id }) => {
      try {
        return ok(await request(`/v1/venues/${venueId}/reservations/${id}`));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "reservation.create",
    {
      title: "Create reservation",
      description:
        "Create a reservation and return it. Pass table ids to assign them explicitly, or omit tables to let the engine assign tables automatically for the party size.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        date: z.string().describe("Date as YYYY-MM-DD."),
        time: z.string().describe("Time as HH:MM in the venue timezone."),
        partySize: z.number().int().positive(),
        tables: z
          .array(z.string())
          .optional()
          .describe("Table ids to assign. Omit to auto-assign."),
        zone: z
          .string()
          .optional()
          .describe("Zone to prefer (e.g. Terrace). When set, tables come from this zone."),
        guestName: z.string().optional(),
        guestContact: z.string().optional(),
        consent: consentSchema,
        rating: ratingSchema,
        commentary: commentarySchema,
        reconfirmation: reconfirmationSchema,
        idempotencyKey: z.string().optional(),
      }),
    },
    async ({ venueId, date, time, partySize, tables, zone, guestName, guestContact, consent, rating, commentary, reconfirmation, idempotencyKey: key }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/reservations`, {
            method: "POST",
            idempotencyKey: idempotencyKey(key),
            body: {
              date,
              time,
              partySize,
              tables,
              zone,
              guest: { name: guestName, contact: guestContact, consent },
              rating,
              commentary,
              reconfirmation,
            },
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "reservation.walk_in",
    {
      title: "Walk-in",
      description:
        "Seat a guest who arrives without a reservation. Defaults the time to now in the venue timezone.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        partySize: z.number().int().positive(),
        date: z.string().optional().describe("Date as YYYY-MM-DD. Defaults to today."),
        time: z.string().optional().describe("Time as HH:MM. Defaults to now."),
        tables: z.array(z.string()).optional().describe("Table ids. Omit to auto-assign."),
        zone: z.string().optional(),
        guestName: z.string().optional(),
        guestContact: z.string().optional(),
        consent: consentSchema,
        rating: ratingSchema,
        commentary: commentarySchema,
        idempotencyKey: z.string().optional(),
      }),
    },
    async ({ venueId, partySize, date, time, tables, zone, guestName, guestContact, consent, rating, commentary, idempotencyKey: key }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/reservations/walk-in`, {
            method: "POST",
            idempotencyKey: idempotencyKey(key),
            body: {
              date,
              time,
              partySize,
              tables,
              zone,
              guest: { name: guestName, contact: guestContact, consent },
              rating,
              commentary,
            },
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "reservation.modify",
    {
      title: "Modify reservation",
      description: "Modify a reservation's party size, tables, contact consent, rating, booking note, and/or reconfirmation.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        id: z.string(),
        partySize: z.number().int().positive().optional(),
        tables: z.array(z.string()).min(1).optional(),
        consent: consentSchema,
        rating: ratingSchema,
        commentary: commentarySchema,
        reconfirmation: reconfirmationSchema,
        idempotencyKey: z.string().optional(),
      }),
    },
    async ({ venueId, id, partySize, tables, consent, rating, commentary, reconfirmation, idempotencyKey: key }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/reservations/${id}/modify`, {
            method: "POST",
            idempotencyKey: idempotencyKey(key),
            body: { partySize, tables, guest: consent ? { consent } : undefined, rating, commentary, reconfirmation },
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "reservation.cancel",
    {
      title: "Cancel reservation",
      description: "Cancel a reservation. Idempotent for the same key.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        id: z.string(),
        idempotencyKey: z.string().optional(),
      }),
    },
    async ({ venueId, id, idempotencyKey: key }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/reservations/${id}/cancel`, {
            method: "POST",
            idempotencyKey: idempotencyKey(key),
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "reservation.status",
    {
      title: "Set reservation status",
      description:
        "Advance a reservation status: seat, mark attended, or mark no-show. Seating needs a table: a booking without tables fails with table_required, so assign one with reservation.modify first.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        id: z.string(),
        status: z.enum(["seated", "attended", "no_show"]),
        idempotencyKey: z.string().optional(),
      }),
    },
    async ({ venueId, id, status, idempotencyKey: key }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/reservations/${id}/status`, {
            method: "POST",
            idempotencyKey: idempotencyKey(key),
            body: { status },
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "reservation.events",
    {
      title: "Reservation events",
      description: "Read the reservation event feed for a venue, from a cursor.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
    },
    async ({ venueId, cursor, limit }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/events`, { query: { cursor, limit } }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "reservation.erasure",
    {
      title: "Erase personal data",
      description:
        "Erase guest data for a venue, by guest id or owner principal. A guest id erases the guest record, every reservation linked to it, and the venue's waitlist entries with the same contact. An owner principal erases the reservations it owns and the guest records left with no other visit. A guest id that is not a record is read as a contact, which is deprecated. Returns counts of erased reservations, guest records, and waitlist entries.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        guestId: z
          .string()
          .optional()
          .describe("Guest record id from a reservation's guest.guestId. A contact still works for one version and is deprecated."),
        principal: z.string().optional().describe("Owner principal to erase."),
      }),
    },
    async ({ venueId, guestId, principal }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/erasure`, {
            method: "POST",
            body: { guestId, principal },
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "venue.getConfig",
    {
      title: "Get venue config",
      description: "Read whether a venue accepts reservations and its notice address.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ venueId: z.string() }),
    },
    async ({ venueId }) => {
      try {
        return ok(await request(`/v1/venues/${venueId}/config`));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "venue.setConfig",
    {
      title: "Set venue config",
      description:
        "Enable or disable reservations and set the notice address. Enabling requires a notice address.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        enabled: z.boolean().optional(),
        noticeAddress: z.string().optional(),
        notificationsEnabled: z.boolean().optional(),
        resendApiKey: z.string().optional(),
        fromEmail: z.string().optional(),
        slotIntervalMinutes: z.number().int().nonnegative().optional(),
        leadTimeMinutes: z.number().int().nonnegative().optional(),
        lastSeatingOffsetMinutes: z.number().int().nonnegative().optional(),
        phoneCountry: z
          .string()
          .nullable()
          .optional()
          .describe("ISO 3166 alpha-2 country for phone numbers without a country code. Null follows the venue time zone."),
        overbookingCeiling: z
          .number()
          .int()
          .min(0)
          .max(1000)
          .optional()
          .describe(
            "The most covers the venue accepts without tables at one time. 0 means every booking holds tables.",
          ),
        maxAdvanceDays: z
          .number()
          .int()
          .min(0)
          .max(1000)
          .nullable()
          .optional()
          .describe("Refuse bookings more than this many days ahead, counted from today in the venue time zone. Null turns it off."),
        maxActivePerGuestPerDay: z
          .number()
          .int()
          .min(1)
          .max(100)
          .nullable()
          .optional()
          .describe("The most active bookings one guest, identified by contact, may hold on one date. Null turns it off."),
        blockedDates: z
          .array(
            z.union([
              z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
            ]),
          )
          .max(366)
          .optional()
          .describe("Dates (YYYY-MM-DD) or { from, to } ranges, inclusive, in the venue time zone, on which no bookings are taken. Replaces the list. An empty list clears it."),
      }),
    },
    async ({ venueId, enabled, noticeAddress, notificationsEnabled, resendApiKey, fromEmail, slotIntervalMinutes, leadTimeMinutes, lastSeatingOffsetMinutes, phoneCountry, overbookingCeiling, maxAdvanceDays, maxActivePerGuestPerDay, blockedDates }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/config`, {
            method: "PUT",
            body: {
              enabled,
              noticeAddress,
              notificationsEnabled,
              resendApiKey,
              fromEmail,
              slotIntervalMinutes,
              leadTimeMinutes,
              lastSeatingOffsetMinutes,
              phoneCountry,
              overbookingCeiling,
              maxAdvanceDays,
              maxActivePerGuestPerDay,
              blockedDates,
            },
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "waitlist.list",
    {
      title: "List waitlist",
      description: "List the guests currently waiting for a table.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ venueId: z.string() }),
    },
    async ({ venueId }) => {
      try {
        return ok(await request(`/v1/venues/${venueId}/waitlist`));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "waitlist.add",
    {
      title: "Add to waitlist",
      description: "Add a guest to the waitlist when no table is available.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        venueId: z.string(),
        partySize: z.number().int().positive(),
        zone: z.string().optional(),
        guestName: z.string().optional(),
        guestContact: z.string().optional(),
      }),
    },
    async ({ venueId, partySize, zone, guestName, guestContact }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/waitlist`, {
            method: "POST",
            body: { partySize, zone, guest: { name: guestName, contact: guestContact } },
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "waitlist.seat",
    {
      title: "Seat a waitlist entry",
      description: "Seat a waiting guest, turning the entry into a reservation.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        id: z.string(),
        idempotencyKey: z.string().optional(),
      }),
    },
    async ({ venueId, id, idempotencyKey: key }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/waitlist/${id}/seat`, {
            method: "POST",
            idempotencyKey: idempotencyKey(key),
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "waitlist.cancel",
    {
      title: "Cancel a waitlist entry",
      description: "Remove a guest from the waitlist.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        venueId: z.string(),
        id: z.string(),
      }),
    },
    async ({ venueId, id }) => {
      try {
        return ok(
          await request(`/v1/venues/${venueId}/waitlist/${id}/cancel`, {
            method: "POST",
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
