import type { Failure } from "./api";
import type { MessageId } from "./messages";

// What the guest reads for each public error code (docs/contract/errors.md), and where the form sends them
// back to. `booking_declined` is absent on purpose: it reads as any unexpected failure, so a guest cannot tell
// that the venue declined the contact (ADR-0018).

export interface Explanation {
  message: MessageId;
  /** `time`: the chosen time is gone, so the guest picks another from a fresh list. */
  back?: "time";
  /** Offer the venue's phone, when it has one. */
  phone?: boolean;
}

const BY_CODE: Record<string, Explanation> = {
  rate_limited: { message: "error.rateLimited" },
  slot_taken: { message: "error.slotTaken", back: "time" },
  no_suitable_table: { message: "error.slotTaken", back: "time" },
  outside_hours: { message: "error.timeUnavailable", back: "time" },
  lead_time_violation: { message: "error.timeUnavailable", back: "time" },
  beyond_booking_horizon: { message: "error.timeUnavailable", back: "time" },
  date_blocked: { message: "error.timeUnavailable", back: "time" },
  party_size_too_large: { message: "error.partySize", back: "time" },
  party_size_too_small: { message: "error.partySize", back: "time" },
  guest_booking_limit: { message: "error.contactLimit" },
  online_booking_limit: { message: "error.contactLimit" },
  invalid_request: { message: "error.invalid" },
  venue_not_found: { message: "error.unavailable" },
};

const UNEXPECTED: Explanation = { message: "error.generic", phone: true };

export function explain(failure: Failure): Explanation {
  if (failure.kind === "network") return { message: "error.network" };
  if (failure.kind === "local") return UNEXPECTED;
  return BY_CODE[failure.code] ?? UNEXPECTED;
}
