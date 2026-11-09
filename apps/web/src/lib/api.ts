export type Role = "read" | "write" | "admin";

export interface Venue {
  id: string;
  name: string;
  timezone: string;
  enabled: boolean;
  role: Role;
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

  agenda: (venueId: string, date: string) =>
    request<{ reservations: Reservation[] }>(
      `/v1/venues/${venueId}/agenda?date=${date}`,
    ),
};
