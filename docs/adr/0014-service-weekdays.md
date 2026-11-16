# ADR-0014: Service weekdays

- Status: Accepted
- Date: 2026-11-16
- Deciders: David Cabeza

## Context

A service has `openStart` and `openEnd` and no weekday, so it runs every day. A venue that closes on Mondays, or serves lunch only at weekends, cannot say so. Availability offers slots on the closed day, and the public JSON-LD (ADR-0012) publishes false opening hours (GitHub issue #82).

Facts read in the code: `timeReasons` in `apps/api/src/lib/reservations.ts` finds the service for a time and feeds create, availability and the explanation. Walk-ins skip the slot grid, the lead time and the service limits, but not the service hours. `gridAvailability` and pacing walk each service window. An overnight service (18:00 to 01:00) has slots after midnight whose request date is the next date.

## Decision

- `services.days`, `smallint[]`, not null, default `{1,2,3,4,5,6,7}`, with a check that it has 1 to 7 elements, all in 1..7. ISO weekdays, 1 Monday to 7 Sunday, to match what callers and `Date` helpers already speak. The default keeps every existing row and behavior unchanged. The API sorts and rejects duplicates, so stored sets are canonical.
- `POST /services` takes optional `days`. Left out, it keeps the stored value (all seven for a new service). An empty list, `null`, an out-of-range value, a duplicate or a non-array fails with `invalid_request`. To restore all days send all seven. Reads return `days` ascending. Admin only, as the route already is.
- The weekday is the weekday of the calendar date the caller names, which is already the venue's local date. It is never derived from the UTC date of an instant. No time zone conversion is needed, and a booking at 00:30 local on a Saturday is a Saturday even when UTC says Friday.
- An overnight service belongs to the day it opens. A time inside the part after midnight is checked against the previous date's weekday. A service with `days` `[5]` and hours 18:00 to 01:00 serves Friday 23:30 and Saturday 00:30, not Saturday 18:00. This matches schema.org, where `dayOfWeek` with `opens` and `closes` describes the opening day.
- Create, availability and the explanation share `serviceAt`, so they agree. Availability omits a service on a day it does not serve. Pacing does too.
- A closed day is `outside_hours`, not a new error code, because the caller's fix is the same (pick another time) and the retry hint is the same. The explanation says why: details rule `weekday` with the date, its weekday and the services that cover the time by hours with their `days`. A time that no service covers by hours keeps rule `hours`. No new code, so `errors.md` and the staff app's message table do not change.
- Walk-ins are held to the weekday. They already must fall inside a service window, because the venue is open then. A service that does not run that day is not open, so staff cannot seat a walk-in into it. A venue that wants to take people on a day adds the day to the service. This is the stricter reading and the simplest rule: weekday is part of the hours, and C8 only exempts the slot grid.
- The JSON-LD emits one `openingHoursSpecification` per service with only that service's days, an overnight service on the day it opens.

## Consequences

**Easier.** A venue that closes a day publishes true hours and offers no slots on it. One column, one check, no new endpoint.

**Harder.** Two services that overlap in time and differ in days resolve by the first match that serves the date. Callers that count services in the availability answer see fewer keys on a closed day, not empty lists. The early hours of a Saturday belong to Friday's service, so a venue that changes `days` changes those hours too. Pacing does not show the tail of the previous day's overnight service, as before.

**Accepted.** Exceptions for a single date (holidays) are still `blockedDates` (ADR-0013). Per-day hours (different times on different days) are done with two services. A service has one set of days, not one set per time.

## Alternatives considered

- **A bitmask integer.** Rejected. An array reads and validates more clearly, and the check is as small.
- **A per-day hours table.** Rejected as a larger change. Two services cover the case.
- **A new error code `closed_day`.** Rejected. It adds a code, an `errors.md` entry and a message for no change in what the caller does. A reason detail carries it.
- **Walk-ins bypass the weekday.** Rejected, see above.
- **A `null` `days` that means all.** Rejected. A non-null set with a default has one meaning.
