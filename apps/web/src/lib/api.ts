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
}

export interface Service {
  name: string;
  openStart: string;
  openEnd: string;
}

export interface VenueConfig {
  enabled: boolean;
  noticeAddress: string;
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

  upsertTable: (venueId: string, body: { id: string; name: string; seats: number; zone?: string }) =>
    request<{ tables: Table[] }>(`/v1/venues/${venueId}/tables`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteTable: (venueId: string, tableId: string) =>
    request<{ tables: Table[] }>(
      `/v1/venues/${venueId}/tables/${encodeURIComponent(tableId)}`,
      { method: "DELETE" },
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

  setConfig: (venueId: string, body: { enabled?: boolean; noticeAddress?: string }) =>
    request<VenueConfig>(`/v1/venues/${venueId}/config`, {
      method: "PUT",
      body: JSON.stringify(body),
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
};
