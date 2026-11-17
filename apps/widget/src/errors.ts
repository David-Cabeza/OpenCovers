import type { Failure, Result } from "./api";
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

/**
 * What the guest reads after asking for a lost link. Every answer but a failed connection and a rate limit reads
 * the same, so the page never tells whether the address holds a booking, whatever the engine answered.
 */
export function explainResend(result: Result<unknown>): MessageId {
  if (result.ok) return "lost.sent";
  if (result.failure.kind === "network") return "error.network";
  if (result.failure.kind === "error" && result.failure.code === "rate_limited") return "error.rateLimited";
  return "lost.sent";
}

/**
 * What the self-service page does with a failed call. `invalid`: the link does not work, for a reason the page
 * never tells (C47). `closed`: changes are over, so the page shows the booking read-only. `changed`: the booking
 * changed since the guest read it, so the page reads it again before the guest decides.
 */
export type SelfServiceOutcome =
  | { kind: "invalid" }
  | { kind: "closed" }
  | { kind: "changed" }
  | { kind: "notice"; notice: Explanation };

const SELF_SERVICE_BY_CODE: Record<string, SelfServiceOutcome> = {
  self_service_link_invalid: { kind: "invalid" },
  self_service_closed: { kind: "closed" },
  reservation_changed: { kind: "changed" },
  party_size_too_small: { kind: "notice", notice: { message: "manage.error.partySize", phone: true } },
  party_size_too_large: { kind: "notice", notice: { message: "manage.error.partySize", phone: true } },
  no_suitable_table: { kind: "notice", notice: { message: "manage.error.noTable", phone: true } },
  invalid_request: { kind: "notice", notice: { message: "error.invalid" } },
  rate_limited: { kind: "notice", notice: { message: "error.rateLimited" } },
};

const SELF_SERVICE_UNEXPECTED: SelfServiceOutcome = {
  kind: "notice",
  notice: { message: "manage.error.generic", phone: true },
};

export function explainSelfService(failure: Failure): SelfServiceOutcome {
  if (failure.kind === "network") return { kind: "notice", notice: { message: "error.network" } };
  if (failure.kind === "local") return SELF_SERVICE_UNEXPECTED;
  return SELF_SERVICE_BY_CODE[failure.code] ?? SELF_SERVICE_UNEXPECTED;
}
