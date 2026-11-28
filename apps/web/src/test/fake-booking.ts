import type { Reservation } from "@/lib/api";
import type { MockResponse, RecordedRequest } from "@/test/mock-api";

/**
 * One booking that answers reads and modifies the way the engine does where a client can tell (C87): a `version` other
 * than the stored one is refused and writes nothing, and a body that changes something bumps the version.
 */
export function fakeBooking(initial: Reservation) {
  const path = `/v1/venues/${initial.venueId}/reservations/${initial.id}`;
  const server = {
    stored: initial,
    /** A write made from somewhere else. */
    change(changes: Partial<Reservation>) {
      server.stored = { ...server.stored, ...changes, version: server.stored.version + 1 };
    },
    routes: {
      [`GET ${path}`]: (): MockResponse => ({ body: server.stored }),
      [`POST ${path}/modify`]: (req: RecordedRequest): MockResponse => {
        const { version, guest, dietary, ...changes } = req.body as Record<string, any>;
        if (version !== undefined && version !== server.stored.version) {
          return { status: 409, body: { code: "reservation_changed" } };
        }
        server.change({
          ...changes,
          ...(guest ? { guest: { ...server.stored.guest, ...guest } } : {}),
          ...(dietary !== undefined ? { dietary: dietary ?? undefined } : {}),
        });
        return { body: server.stored };
      },
    },
  };
  return server;
}
