// What each staff reservation and waitlist write takes (C94): one field list per route, and nothing else passes.

import { INVALID, integer, oneOf, optional, optionalObject, text, type Check, type FieldProblem } from "./body";
import { isCommentary } from "./commentary";
import { CONSENTS } from "./consent";
import { dietaryField } from "./dietary";
import { isRating, type Rating } from "./rating";
import { RECONFIRMATIONS } from "./reconfirmation";
import { isCalendarDate } from "./time";

export const MAX_PARTY_SIZE = 10_000;
/** The public create's limit. A longer address does not fit the guest index and used to answer 500. */
export const MAX_CONTACT_LENGTH = 254;

// A text column cannot store a NUL, so it fails here and not as a database error.
const NO_NUL = /^[^\0]*$/;
const anyText = text(Number.MAX_SAFE_INTEGER, NO_NUL);

const partySize = integer(1, MAX_PARTY_SIZE);
const date: Check<string> = (value) => (isCalendarDate(value) ? value : INVALID);
const time = text(5, /^([01]\d|2[0-3]):[0-5]\d$/);
const tableIds: Check<string[]> = (value) =>
  Array.isArray(value) && value.every((id) => typeof id === "string" && NO_NUL.test(id)) ? value : INVALID;
const rating: Check<Rating | null> = (value) => (value === null || isRating(value) ? value : INVALID);
const commentary: Check<string> = (value) => (isCommentary(value) && NO_NUL.test(value) ? value : INVALID);
const consent = oneOf(CONSENTS);

const contactFields = { name: optional(anyText), contact: optional(text(MAX_CONTACT_LENGTH, NO_NUL)) };

const bookingFields = {
  partySize,
  tables: optional(tableIds),
  zone: optional(anyText),
  guest: optionalObject({ ...contactFields, consent: optional(consent) }),
  rating: optional(rating),
  commentary: optional(commentary),
  dietary: dietaryField,
};

export const CREATE_FIELDS = { date, time, ...bookingFields, reconfirmation: optional(oneOf(RECONFIRMATIONS)) };

export const WALK_IN_FIELDS = { date: optional(date), time: optional(time), ...bookingFields };

export const MODIFY_FIELDS = {
  // C87: not a change. The write goes through only while the stored version equals it.
  version: optional(integer(1, Number.MAX_SAFE_INTEGER)),
  partySize: optional(partySize),
  tables: optional(tableIds),
  guest: optionalObject({ consent: optional(consent) }),
  rating: optional(rating),
  commentary: optional(commentary),
  reconfirmation: optional(oneOf(RECONFIRMATIONS)),
  dietary: dietaryField,
  // A modify does not move a booking. These may only restate it, which `movedFields` checks under the row lock.
  date: optional(anyText),
  time: optional(anyText),
  zone: optional(anyText),
};

export const STATUS_FIELDS = { status: oneOf(["seated", "attended", "no_show"] as const) };

export const WAITLIST_ADD_FIELDS = { partySize, zone: optional(anyText), guest: optionalObject(contactFields) };

export interface Slot {
  date: string;
  time: string;
  zone: string;
}

/** The restated values that differ from what a read of the booking returns, compared as exact strings. */
export function movedFields(restated: Partial<Slot>, stored: Slot): FieldProblem[] {
  return (["date", "time", "zone"] as const)
    .filter((name) => restated[name] !== undefined && restated[name] !== stored[name])
    .map((path) => ({ path, problem: "unchangeable" }));
}
