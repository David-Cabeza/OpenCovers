export type Role = "read" | "write" | "admin";

export interface Venue {
  id: string;
  name: string;
  timezone: string;
  enabled: boolean;
  role: Role;
}

export interface Table {
  id: string;
  name: string;
  seats: number;
  zone: string;
  shape: string;
  posX: number;
  posY: number;
}

export interface Service {
  name: string;
  openStart: string;
  openEnd: string;
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
  };
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

  setTablePosition: (venueId: string, tableId: string, x: number, y: number) =>
    request<{ tables: Table[] }>(
      `/v1/venues/${venueId}/tables/${encodeURIComponent(tableId)}/position`,
      { method: "PATCH", body: JSON.stringify({ x, y }) },
    ),

  listServices: (venueId: string) =>
    request<{ services: Service[] }>(`/v1/venues/${venueId}/services`),

  upsertService: (venueId: string, body: { name: string; openStart: string; openEnd: string }) =>
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
    },
  ) =>
    request<VenueConfig>(`/v1/venues/${venueId}/config`, {
      method: "PUT",
      body: JSON.stringify(body),
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

  agenda: (venueId: string, date: string) =>
    request<{ reservations: Reservation[] }>(
      `/v1/venues/${venueId}/agenda?date=${date}`,
    ),

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
    body: { partySize?: number; tables?: string[] },
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
    body: { partySize: number; tables?: string[]; zone?: string; guest?: { name?: string; contact?: string } },
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
    }),
};
