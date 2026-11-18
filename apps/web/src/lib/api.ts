import type { OnlineBooking, OnlineBookingSaved, OnlineBookingUpdate } from "@/lib/online-booking";
import type { PublicProfile } from "@/lib/public-profile";

export type Role ="read" | "write" | "admin";

export interface Venue {
  id: string;
  name: string;
  timezone: string;
  enabled: boolean;
  role: Role;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export type AuditAction =
  | "invited"
  | "invite_revoked"
  | "redeemed"
  | "member_removed"
  | "role_changed"
  | "creator_transferred"
  | "guest_blocked"
  | "guest_unblocked";

export interface AuditEntry {
  id: string;
  action: AuditAction;
  actorUserId: string | null;
  targetUserId: string | null;
  invitationId: string | null;
  role: string | null;
  blocklistEntryId: string | null;
  occurredAt: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

export interface RemovedMember {
  member: { userId: string; role: Role };
  revoked: { keys: number; sessions: number; webhooksFlagged: number };
}

export type InvitationStatus = "pending" | "redeemed" | "revoked" | "expired";

export interface Invitation {
  id: string;
  role: Role;
  email: string | null;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}

export interface InvitationCreated extends Invitation {
  token: string;
}

export interface Table {
  id: string;
  name: string;
  seats: number;
  zone: string;
  shape: string;
  posX: number;
  posY: number;
  rotation: number;
}

export interface Service {
  name: string;
  openStart: string;
  openEnd: string;
  /** ISO weekdays the service opens on, 1 Monday to 7 Sunday. */
  days: number[];
}

export interface VenueConfig {
  enabled: boolean;
  noticeAddress: string;
  notificationsEnabled: boolean;
  resendConfigured: boolean;
  fromEmail: string;
  slotIntervalMinutes: number;
  leadTimeMinutes: number;
  lastSeatingOffsetMinutes: number;
  overbookingCeiling: number;
  maxAdvanceDays: number | null;
  maxActivePerGuestPerDay: number | null;
  blockedDates: { from: string; to: string }[];
}

export interface ApiKey {
  principal: string;
  role: Role;
  hash: string;
}

export interface WaitlistEntry {
  id: string;
  venueId: string;
  partySize: number;
  zone: string;
  guestName: string;
  guestContact: string;
  status: string;
  reservationId: string | null;
  createdAt: string;
}

export interface FloorTable {
  id: string;
  name: string;
  seats: number;
  zone: string;
  shape: string;
  posX: number;
  posY: number;
  rotation: number;
  occupied: boolean;
  reservationId?: string;
  partySize?: number;
  guestName?: string;
}

export interface PacingSlot {
  time: string;
  capacity: number;
  covers: number;
}

export interface PacingService {
  service: string;
  slots: PacingSlot[];
}

export interface FloorItem {
  id: string;
  venueId: string;
  type: string;
  label: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
}

export type Consent = "unknown" | "granted" | "denied";

export type Reconfirmation = "none" | "requested" | "confirmed" | "declined" | "no_answer";

export const COMMENTARY_MAX = 500;

export interface Reservation {
  id: string;
  venueId: string;
  date: string;
  time: string;
  service: string;
  partySize: number;
  status: string;
  version: number;
  bookedVia: string;
  guest: {
    name?: string;
    contact?: string;
    consent?: Consent;
  };
  rating?: number | null;
  commentary?: string;
  reconfirmation?: Reconfirmation;
  reconfirmationRecordedAt?: string | null;
  zone?: string;
  tables?: string[];
}

export interface AvailabilitySlot {
  time: string;
  available: boolean;
  type: string;
}

export type Availability = Record<string, AvailabilitySlot[]>;

export interface CreateReservationBody {
  date: string;
  time: string;
  partySize: number;
  tables: string[];
  guest?: {
    name?: string;
    contact?: string;
  };
  commentary?: string;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    throw new ApiError(body?.code ?? "error", res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listVenues: () => request<{ venues: Venue[] }>("/v1/venues"),

  createVenue: (body: { name: string; timezone?: string }) =>
    request<{ venue: { id: string; name: string } }>("/v1/venues", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listTables: (venueId: string) =>
    request<{ tables: Table[] }>(`/v1/venues/${venueId}/tables`),

  getFloorPlan: (venueId: string, date?: string, time?: string) =>
    request<{ tables: FloorTable[] }>(
      `/v1/venues/${venueId}/floor${
        date && time ? `?date=${date}&time=${time}` : ""
      }`,
    ),

  getPacing: (venueId: string, date: string) =>
    request<{ pacing: PacingService[] }>(
      `/v1/venues/${venueId}/pacing?date=${date}`,
    ),

  upsertTable: (venueId: string, body: { id: string; name: string; seats: number; zone?: string; shape?: string }) =>
    request<{ tables: Table[] }>(`/v1/venues/${venueId}/tables`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteTable: (venueId: string, tableId: string) =>
    request<{ tables: Table[] }>(
      `/v1/venues/${venueId}/tables/${encodeURIComponent(tableId)}`,
      { method: "DELETE" },
    ),

  updateTableLayout: (
    venueId: string,
    tableId: string,
    body: { x?: number; y?: number; rotation?: number },
  ) =>
    request<{ tables: Table[] }>(
      `/v1/venues/${venueId}/tables/${encodeURIComponent(tableId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  listFloorItems: (venueId: string) =>
    request<{ items: FloorItem[] }>(`/v1/venues/${venueId}/floor-items`),

  addFloorItem: (
    venueId: string,
    body: { type: string; label?: string; width?: number; height?: number },
  ) =>
    request<{ items: FloorItem[] }>(`/v1/venues/${venueId}/floor-items`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteFloorItem: (venueId: string, itemId: string) =>
    request<{ items: FloorItem[] }>(
      `/v1/venues/${venueId}/floor-items/${encodeURIComponent(itemId)}`,
      { method: "DELETE" },
    ),

  updateFloorItemLayout: (
    venueId: string,
    itemId: string,
    body: { x?: number; y?: number; rotation?: number; width?: number; height?: number },
  ) =>
    request<{ items: FloorItem[] }>(
      `/v1/venues/${venueId}/floor-items/${encodeURIComponent(itemId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  listServices: (venueId: string) =>
    request<{ services: Service[] }>(`/v1/venues/${venueId}/services`),

  upsertService: (
    venueId: string,
    body: { name: string; openStart: string; openEnd: string; days?: number[] },
  ) =>
    request<{ services: Service[] }>(`/v1/venues/${venueId}/services`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteService: (venueId: string, name: string) =>
    request<{ services: Service[] }>(
      `/v1/venues/${venueId}/services/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),

  getConfig: (venueId: string) =>
    request<VenueConfig>(`/v1/venues/${venueId}/config`),

  setConfig: (
    venueId: string,
    body: {
      enabled?: boolean;
      noticeAddress?: string;
      notificationsEnabled?: boolean;
      resendApiKey?: string;
      fromEmail?: string;
      slotIntervalMinutes?: number;
      leadTimeMinutes?: number;
      lastSeatingOffsetMinutes?: number;
      overbookingCeiling?: number;
      maxAdvanceDays?: number | null;
      maxActivePerGuestPerDay?: number | null;
      blockedDates?: { from: string; to: string }[];
    },
  ) =>
    request<VenueConfig>(`/v1/venues/${venueId}/config`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  getPublicProfile: (venueId: string) =>
    request<PublicProfile>(`/v1/venues/${venueId}/public-profile`),

  setPublicProfile: (venueId: string, body: Partial<PublicProfile>) =>
    request<PublicProfile>(`/v1/venues/${venueId}/public-profile`, {
      method: "PUT",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    }),

  getOnlineBooking: (venueId: string) =>
    request<OnlineBooking>(`/v1/venues/${venueId}/online-booking`),

  setOnlineBooking: (venueId: string, body: OnlineBookingUpdate) =>
    request<OnlineBookingSaved>(`/v1/venues/${venueId}/online-booking`, {
      method: "PUT",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    }),

  rotateBookingKey: (venueId: string) =>
    request<OnlineBooking>(`/v1/venues/${venueId}/online-booking/rotate-key`, {
      method: "POST",
    }),

  listVenueKeys: (venueId: string) =>
    request<{ keys: ApiKey[] }>(`/v1/venues/${venueId}/keys`),

  createVenueKey: (
    venueId: string,
    body: { key: string; principal: string; role: "read" | "write" },
  ) =>
    request<{ keys: ApiKey[] }>(`/v1/venues/${venueId}/keys`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  revokeVenueKey: (venueId: string, hash: string) =>
    request<{ keys: ApiKey[] }>(`/v1/venues/${venueId}/keys`, {
      method: "DELETE",
      body: JSON.stringify({ hash }),
    }),

  listMembers: (venueId: string) =>
    request<{ members: Member[] }>(`/v1/venues/${venueId}/members`),

  removeMember: (venueId: string, userId: string) =>
    request<RemovedMember>(
      `/v1/venues/${venueId}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),

  changeMemberRole: (venueId: string, userId: string, role: Role) =>
    request<{ member: { userId: string; role: Role } }>(
      `/v1/venues/${venueId}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    ),

  getAccount: () => request<{ account: { userId: string; isCreator: boolean } }>("/v1/account"),

  transferCreator: (userId: string) =>
    request<{ creator: { userId: string } }>("/v1/account/transfer-creator", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),

  listAudit: (venueId: string, cursor?: string | null) => {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return request<AuditPage>(`/v1/venues/${venueId}/audit${qs}`);
  },

  listInvitations: (venueId: string) =>
    request<{ invitations: Invitation[] }>(`/v1/venues/${venueId}/invitations`),

  createInvitation: (
    venueId: string,
    body: { role: Role; email?: string; expiresInHours?: number },
  ) =>
    request<{ invitation: InvitationCreated }>(`/v1/venues/${venueId}/invitations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  revokeInvitation: (venueId: string, invitationId: string) =>
    request<{ invitation: Invitation }>(
      `/v1/venues/${venueId}/invitations/${encodeURIComponent(invitationId)}`,
      { method: "DELETE" },
    ),

  redeemInvitation: (token: string) =>
    request<{ membership: { venueId: string; role: Role } }>("/v1/invitations/redeem", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  agenda: (venueId: string, date: string) =>
    request<{ reservations: Reservation[] }>(
      `/v1/venues/${venueId}/agenda?date=${date}`,
    ),

  getReservation: (venueId: string, id: string) =>
    request<Reservation>(`/v1/venues/${venueId}/reservations/${id}`),

  availability: (venueId: string, date: string, partySize: number) =>
    request<{ availability: Availability }>(
      `/v1/venues/${venueId}/availability?date=${date}&partySize=${partySize}`,
    ),

  createReservation: (venueId: string, body: CreateReservationBody) =>
    request<Reservation>(`/v1/venues/${venueId}/reservations`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    }),

  modifyReservation: (
    venueId: string,
    id: string,
    body: {
      partySize?: number;
      tables?: string[];
      guest?: { consent?: Consent };
      rating?: number | null;
      commentary?: string;
    },
  ) =>
    request<Reservation>(`/v1/venues/${venueId}/reservations/${id}/modify`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    }),

  cancelReservation: (venueId: string, id: string) =>
    request<Reservation>(`/v1/venues/${venueId}/reservations/${id}/cancel`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    }),

  setStatus: (venueId: string, id: string, status: string) =>
    request<Reservation>(`/v1/venues/${venueId}/reservations/${id}/status`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ status }),
    }),

  walkIn: (
    venueId: string,
    body: {
      partySize: number;
      tables?: string[];
      zone?: string;
      guest?: { name?: string; contact?: string; consent?: Consent };
    },
  ) =>
    request<Reservation>(`/v1/venues/${venueId}/reservations/walk-in`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    }),

  listWaitlist: (venueId: string) =>
    request<{ entries: WaitlistEntry[] }>(`/v1/venues/${venueId}/waitlist`),

  addWaitlist: (
    venueId: string,
    body: { partySize: number; zone?: string; guest?: { name?: string; contact?: string } },
  ) =>
    request<{ entries: WaitlistEntry[] }>(`/v1/venues/${venueId}/waitlist`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    }),

  seatWaitlist: (venueId: string, id: string) =>
    request<Reservation>(`/v1/venues/${venueId}/waitlist/${id}/seat`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    }),

  cancelWaitlist: (venueId: string, id: string) =>
    request<{ entries: WaitlistEntry[] }>(`/v1/venues/${venueId}/waitlist/${id}/cancel`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    }),
};
