import type { FieldProblem, Problem } from "./body";

// retryable: repeating the same request, unchanged, may succeed later.
// False when the caller must change something first (inputs, credentials, state).
export const ERRORS = {
  invalid_request: { status: 400, retryable: false },
  invalid_invitation: { status: 400, retryable: false },
  invitation_not_found: { status: 404, retryable: false },
  invitation_redeemed: { status: 409, retryable: false },
  member_not_found: { status: 404, retryable: false },
  last_admin: { status: 409, retryable: false },
  unauthorized: { status: 401, retryable: false },
  forbidden: { status: 403, retryable: false },
  venue_creation_closed: { status: 403, retryable: false },
  reservation_not_found: { status: 404, retryable: false },
  waitlist_entry_not_found: { status: 404, retryable: false },
  venue_not_found: { status: 404, retryable: false },
  guest_not_found: { status: 404, retryable: false },
  guest_merged: { status: 409, retryable: false },
  guest_not_merged: { status: 409, retryable: false },
  unmerge_unavailable: { status: 409, retryable: false },
  slot_taken: { status: 409, retryable: false },
  no_suitable_table: { status: 409, retryable: false },
  table_required: { status: 409, retryable: false },
  invalid_transition: { status: 409, retryable: false },
  already_cancelled: { status: 409, retryable: false },
  notice_address_required: { status: 409, retryable: false },
  public_profile_incomplete: { status: 409, retryable: false },
  party_size_too_large: { status: 400, retryable: false },
  party_size_too_small: { status: 400, retryable: false },
  outside_hours: { status: 400, retryable: false },
  lead_time_violation: { status: 400, retryable: false },
  beyond_booking_horizon: { status: 400, retryable: false },
  date_blocked: { status: 400, retryable: false },
  guest_booking_limit: { status: 409, retryable: false },
  expired_cursor: { status: 400, retryable: false },
  table_not_found: { status: 404, retryable: false },
  floor_item_not_found: { status: 404, retryable: false },
  key_conflict: { status: 409, retryable: false },
  webhook_not_found: { status: 404, retryable: false },
  webhook_url_rejected: { status: 400, retryable: false },
  webhook_limit_reached: { status: 409, retryable: false },
  blocklist_entry_not_found: { status: 404, retryable: false },
  blocklist_limit_reached: { status: 409, retryable: false },
  rate_limited: { status: 429, retryable: true },
  transient: { status: 500, retryable: true },
  // A reservation write that waited too long for another write of the venue, or lost a deadlock. Nothing was written.
  venue_busy: { status: 503, retryable: true },
  // The next seven are in the vocabulary but no route emits them yet.
  booking_declined: { status: 409, retryable: false },
  idempotency_in_flight: { status: 409, retryable: true },
  unknown_outcome: { status: 503, retryable: true },
  email_required: { status: 400, retryable: false },
  confirmation_required: { status: 409, retryable: false },
  approval_required: { status: 409, retryable: false },
  stale_second_factor: { status: 403, retryable: false },
  // The public booking channel of ADR-0017. In the contract, not emitted until stages 2 to 4.
  online_booking_incomplete: { status: 409, retryable: false },
  online_booking_limit: { status: 409, retryable: false },
  self_service_link_invalid: { status: 404, retryable: false },
  self_service_closed: { status: 409, retryable: false },
  reservation_changed: { status: 409, retryable: false },
  // The public waitlist of ADR-0021 (stage 11): a join refused for a closed date, the waitlist off, email off or a cap.
  waitlist_unavailable: { status: 409, retryable: false },
} as const satisfies Record<string, { status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503; retryable: boolean }>;

export type ErrorCode = keyof typeof ERRORS;

export function errorBody(code: ErrorCode) {
  return { code, message: code, retryable: ERRORS[code].retryable };
}

const PROBLEM_TEXT: Record<Problem, string> = {
  unknown: "Unknown field",
  missing: "Missing field",
  invalid: "Invalid field",
  unchangeable: "Field cannot be changed",
};

/** `invalid_request` for an authenticated route, naming what is wrong (C94). It carries names, never a sent value. */
export function invalidBodyError(fields: FieldProblem[]) {
  if (fields.length === 0) return { ...errorBody("invalid_request"), message: "The body must be a JSON object" };
  const message = fields.map((f) => `${PROBLEM_TEXT[f.problem]}: ${f.path}`).join(". ");
  return { ...errorBody("invalid_request"), message, details: { fields } };
}
