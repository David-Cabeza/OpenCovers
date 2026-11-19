import { ApiError } from "@/lib/api";
import { SERVER_ERROR } from "@/lib/server-status";

// One friendly message per documented API error code (docs/contract/errors.md).
// Short, plain, and with a next step where one helps.
export const MESSAGES: Record<string, string> = {
  // Request errors
  invalid_request: "Some of the details are not valid. Check them and try again.",
  venue_not_found: "This venue no longer exists or you cannot access it.",
  reservation_not_found: "This reservation no longer exists.",
  waitlist_entry_not_found: "This waitlist entry no longer exists.",
  guest_not_found: "This guest no longer exists.",
  // Online booking and the self-service link
  online_booking_incomplete:
    "Add the venue name and make at least one service bookable online before turning online booking on.",
  online_booking_limit: "This contact already has the most online bookings allowed at this venue.",
  self_service_link_invalid: "This booking link no longer works.",
  self_service_closed: "This booking can no longer be changed online. Contact the venue.",
  reservation_changed: "This booking changed since it was loaded. Reload it and try again.",
  // Auth
  unauthorized: "Your session has ended. Sign in again.",
  forbidden: "Only an admin can do this.",
  venue_creation_closed: "This instance does not allow your account to create a venue.",
  // Rate limiting
  rate_limited: "Too many attempts. Wait a moment and try again.",
  // Availability and allocation
  slot_taken: "One of those tables is already taken at that time. Pick another table.",
  party_size_too_large: "The party is too large for that time.",
  party_size_too_small: "The party is too small for that time.",
  no_suitable_table: "Those tables do not fit this party at that time.",
  table_required: "Assign a table first.",
  outside_hours: "That time is outside the venue's opening hours.",
  lead_time_violation: "That time is too soon. Pick a later time.",
  beyond_booking_horizon: "That date is further ahead than this venue takes bookings.",
  date_blocked: "This venue takes no bookings on that date.",
  guest_booking_limit: "This guest already has the most bookings allowed on that date.",
  booking_declined: "This contact is on the venue's blocklist. An admin can remove the entry to take the booking.",
  // Guest
  email_required: "Add the guest's email or phone to continue.",
  confirmation_required: "The guest has to confirm before this can be saved.",
  approval_required: "This needs approval before it can be saved.",
  // State
  already_cancelled: "This reservation is already cancelled.",
  invalid_transition: "This reservation cannot change to that status right now.",
  guest_merged: "One of these guests has already been merged into another.",
  guest_not_merged: "This guest has not been merged.",
  unmerge_unavailable: "This merge can no longer be undone.",
  // Invitations
  invalid_invitation: "This invitation link is not valid. Ask for a new one.",
  invitation_not_found: "This invitation no longer exists.",
  invitation_redeemed: "This invitation has already been used, so it cannot be revoked.",
  // Members
  member_not_found: "This person is not a member of this venue.",
  last_admin: "A venue needs at least one admin. Make someone else an admin first.",
  // Idempotency and outcome
  idempotency_in_flight: "This is already being saved. Wait a moment.",
  unknown_outcome: "We could not confirm that this was saved. Check and try again.",
  transient: "Something went wrong on our side. Try again in a moment.",
  // Notices and erasure
  notice_address_required: "Add a notice address before enabling reservations.",
  public_profile_incomplete:
    "Add the venue name, street, town and country before publishing the public profile, and give both coordinates or none.",
  stale_second_factor: "Your verification has expired. Verify again and retry.",
  // Feed
  expired_cursor: "That position in the event feed is too old. Start again from the latest events.",
  // Webhooks
  webhook_not_found: "This webhook no longer exists.",
  webhook_url_rejected: "That URL cannot be used. It must be a public https address.",
  webhook_limit_reached: "This venue already has the maximum of 5 webhooks.",
  // Blocklist
  blocklist_entry_not_found: "This blocklist entry no longer exists.",
  blocklist_limit_reached: "This venue's blocklist is full. Remove an entry first.",
};

const RATE_LIMITED = MESSAGES.rate_limited as string;

/**
 * Turn any thrown value into text safe to show a staff user.
 * Unknown codes and plain errors (network failures included) use the
 * caller's fallback, so raw codes and internals are never shown.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return RATE_LIMITED;
    return Object.hasOwn(MESSAGES, err.code) ? (MESSAGES[err.code] as string) : fallback;
  }
  return fallback;
}

/** Same, for Better Auth `{ error }` results (`status`, UPPER_SNAKE `code`). */
export function authErrorMessage(
  error: { status?: number; code?: string; message?: string } | null | undefined,
  fallback: string,
): string {
  if (error?.status === 429) return RATE_LIMITED;
  if (error?.status !== undefined && error.status >= 500) return SERVER_ERROR;
  if (error?.code === "INVALID_INVITATION") return MESSAGES.invalid_invitation as string;
  return error?.message || fallback;
}

export function isApiError(err: unknown, code: string): boolean {
  return err instanceof ApiError && err.code === code;
}
