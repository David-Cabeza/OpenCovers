# ADR-0021: Day status, zones and a public waitlist in the booking widget

- Status: Proposed
- Date: 2026-11-19
- Deciders: David Cabeza

Built so far: stages 1 to 12 of section 7. The public waitlist ships off by default, with provisional wording until the legal review (Q11). The record proposed these features so that the contract (`docs/contract/openapi.yaml`), the conformance cases and the code can follow, in that order. It extends [ADR-0017](0017-booking-widget-and-self-service-link.md) and changes some of its rules, listed under Consequences. Open questions for the owner are marked `Q1` to `Q11`.

## Decisions at a glance

| # | Question | Recommended | Main alternative rejected |
| --- | --- | --- | --- |
| 1 | Day status for a strip of days | A new route `GET /v1/public/{bookingKey}/days?from=&days=&partySize=`, at most 14 days, a status per day from the same functions as public availability, and the first free time. | N calls to the availability route per view. |
| 2 | Zones in the public channel | An opt-in list `publicZones` in the online-booking settings. With two or more, availability says which zones have a table at each time and the create accepts one of them as `zone`. With one or none, nothing changes. | Every zone public by default. |
| 3 | A public waitlist | `POST /v1/public/{bookingKey}/waitlist` for a full date, off by default, writing to the staff waitlist with a date and an optional window, and a leave link built like the booking link. A join needs an unticked email consent and sends one email with the leave link. No automatic offers. | A free-form "request" channel outside the waitlist. |
| 4 | Groups above the online maximum | The phone of the public profile and a short catalog text. No data collected. Already built; this record keeps it. | A group request form. |
| 5 | Summary and notice | A summary step with date, time, party, zone and address before the details form. A venue-set `privacyNoticeUrl`. A pre-ticked box is never allowed. | Notice text written by the project. |
| 6 | Staging | Four independent tracks, each with the contract first. PR #192's behavior is kept and its requests move to the new route. | One large widget release. |
| 7 | Non-goals | Vouchers, payments and deposits, Reserve with Google, AI and voice layers. | |

## Context

User feedback says the guest widget is too simple. A commercial reference widget from the sector, observed from screenshots, shows:

- a strip of 12 days with a status per day (available, closed, full, selected) and a calendar for later dates;
- a zone choice (indoor, terrace), with slots that say which zones have a table;
- times grouped by service;
- when a service has no time, a waitlist button, and for large parties a "group request" that points to the venue phone;
- a summary of date, time, party, zone and address above the details form;
- a basic data-protection notice, and the venue phone as a fallback.

It also pre-ticks a marketing consent box, asks for the email twice and the surname separately. We do not copy those.

What exists today, read on `origin/main` at `6743865`:

- `GET /v1/public/{bookingKey}/availability` answers one date and one party size with `times` and a `reason` (`past_date`, `beyond_horizon` or null). It runs `publicTimes` in `apps/api/src/lib/reservations.ts`, which applies the online rules with `applyChannel` and walks the slot grid with `gridAvailability`. That calls `evaluateSlot` per slot, and each call runs `tableReasons`, two queries (the venue's tables and the busy allocations). A day of 30 slots is about 60 queries.
- C42 (`docs/contract/conformance.md`) defines public availability. C40 says no public answer holds a zone or a service name. C43 makes the public create refuse `zone`. ADR-0017 section 2 says "No table or zone choice".
- `tables.zone` and `reservations.zone` are text with default `""` (`apps/api/src/db/schema.ts`). `tableReasons` filters tables by zone when one is named. The staff explanation takes `zone` (C20), and the staff create auto-assigns inside it.
- The staff waitlist (`waitlist` in `schema.ts`, `WaitlistEntry` in `openapi.yaml`) holds party size, zone, name, contact, status `waiting`, `seated` or `cancelled`, and a reservation id. It has no date and no time: it is a same-day queue. `waitlist.seat` creates a seated walk-in now. C58 and C59 cover idempotency and seating once. C57 says adding to the waitlist is not checked against the guest blocklist.
- Every answer under `/v1/public/` sends `Cache-Control: no-store` (middleware in `apps/api/src/app.ts`). `public_read` limits `GET` per address at 300 per 15 minutes (C52, ADR-0007).
- The public config returns `venue.phone` from the venue's `publicPhone` whether or not the public profile is enabled (`venueView` in `apps/api/src/lib/public-booking.ts`). `PublicVenue` holds no address by design (ADR-0017 decision 4).
- The widget already shows "for groups of more than N, call {phone}" when the guest picks "more than N" (`party.largePhone` in `apps/widget/src/messages.ts`, used in `App.tsx`).
- PR #192 (branch `feat/widget-times-first`, open) adds `apps/widget/src/nearby.ts`: it opens on the first bookable day and offers up to 3 nearby free days, calling the availability route per day, in batches of 3, over at most 14 days. That is up to 14 extra requests. A 12-day strip with today's routes is 12 requests per view and per party change.
- ADR-0020 keeps the widget free. Nothing here is paid.

Next free conformance id when this record was written: the highest case in `conformance.md` was C62, so its first new case is C63. Later stages take the next free id when they are written.

## Decision drivers

- **The design rules hold.** One transaction decides availability and booking. The exclusion constraint decides overlap. Every write carries an idempotency key. A booking key reaches one venue. Minimum guest data. Contract and conformance first.
- **No second check.** A read that predicts a booking must call the same reason functions as the create, so they agree by construction.
- **Simple by default.** A venue that changes nothing sees today's widget, plus the strip.
- **No legal text from us.** Notice and consent wording wait for the legal review (ADR-0017 stages 8 and 11, REQ-N4).

## 1. Day status

### Options

| Option | Requests per strip | For | Against |
| --- | --- | --- | --- |
| A. N calls to `/availability` | 12, again on each party change | No contract change. | 12 x `public_read`; a guest who changes the party 3 times spends 48 of 300. Same DB cost as B, plus HTTP overhead. Cannot say `closed` from `full`. |
| B. New range route | 1 | One request; statuses the UI needs; one rate rule. | A new route and cases. Heavier per call. |
| C. Client cache over A | 12 first time, fewer later | No contract change. | Stale "available" leads to `slot_taken`. Does not lower the first view. |

### Decision

Option B. `GET /v1/public/{bookingKey}/days?from=YYYY-MM-DD&days=N&partySize=P`.

- `days` is 1 to 14, default 12. `from` follows the C61 date rules. A calendar for later dates pages with the same route, 14 days per call, only when the guest opens it (Q1).
- Answer: `{ from, partySize, days: [{ date, status, firstTime }] }`, one entry per date, ascending.
- `status` is one of:
  - `available`: `publicTimes` for that date lists at least one time. `firstTime` is the first.
  - `outside_window`: `publicTimes` gives `past_date` or `beyond_horizon`.
  - `closed`: no online service serves that date (`servesDate` after `applyChannel`), or the date is blocked.
  - `full`: none of the above. The venue serves the date online and no time fits this party.
  - `firstTime` is null except for `available`.
- `selected` is a widget state, not an API status.
- A party outside the online limits gives `invalid_request`. The config already publishes the limits, so this reveals nothing, and the widget sends such a party to the phone (section 4). This differs from C42, which answers an empty list. We accept the difference because a strip of `full` days would offer a waitlist the guest cannot join.

### Agreement by construction

The route calls `publicTimes` per date, or a shared helper both use, and maps its result to a status. It does not count tables itself. A test pins, over a grid of dates and party sizes, that `status` is `available` exactly when `/availability` lists a time, and that `firstTime` equals its first time. The create still decides inside its transaction; a day status is a snapshot, as C3 says for availability.

### What it must not reveal

No table ids, counts of tables or covers, service names, zones or guest data, as C40 requires for every public answer.

`full` versus `closed` tells a scraper which open days are fully booked for a party size. That is an occupancy signal. The same signal exists today: an empty `/availability` on a day in `config.weekdays` is `full` or blocked, and probing times per party size shows more. The new route makes it cheaper to collect, one call per 14 days instead of 14. We accept it, bounded by the rate rule below, because the waitlist button needs `full` (Q2 offers a per-venue switch that reports `full` as `closed`).

### Caching, rate limit and cost

- `Cache-Control: no-store`, as every public answer. A shared cache adds stale `available` days for little gain. The widget may keep the answer in memory for the life of the view and refresh it when the guest returns to the time step, as it does for times today.
- A new rule `public_days`, by address, 60 per 15 minutes (`RATE_LIMIT_PUBLIC_DAYS`). The request also counts on `public_read`. Charged as one request, a strip is 12 times cheaper for the guest than option A, so the separate rule bounds what a scraper gets per address.
- DB cost: about 2 queries per slot evaluated, through `tableReasons`. For `available` days the helper may stop at the first free slot, because only `firstTime` is returned. `full` days evaluate every slot. Worst case for 12 full days of 30 slots: about 720 short queries, the same as 12 calls today. Loading tables and allocations once per range is an optimization for later, allowed only if the agreement test still passes, and only after a measurement asks for it.

## 2. Zones

### Options

| Option | For | Against |
| --- | --- | --- |
| A. No zone choice (today) | Simplest. | The terrace question goes to the phone. |
| B. Every zone public | No setting. | Exposes staff zone names such as "Reservado" or "Barra staff". |
| C. Opt-in `publicZones` | The venue chooses names it is happy to show. Default unchanged. | One more setting and an availability shape change. |

### Decision

Option C.

- **Setting.** `publicZones` in the online-booking resource: null or a list of 2 to 10 zone names that exist on at least one table of the venue. Default null. A name with no table, or a list of one, fails with `invalid_request`. Zone names are shown as stored (Q5).
- **Default.** Fewer than two public zones means no zone choice. The answers and the widget are as today.
- **Config.** `PublicConfig.zones`: the public zone names, or `[]`.
- **Availability.** With public zones, `/availability` gains `slots: [{ time, zones }]` beside `times`. `zones` lists the public zones in which a table fits the party at that time. `times` stays the union, so a client that ignores `slots` keeps working. An optional `zone` query narrows `times` to one zone.
- **Create.** The public create accepts `zone` only when it is in `publicZones`; any other value fails with `invalid_request`. Without `zone` it behaves as today (Q4).
- **Engine.** No new rule. A zone runs `tableReasons` with that zone, the same path as the staff create with `zone` and the explanation of C20. Availability per zone and the create with that zone agree by construction. Cost: one `tableReasons` per public zone per slot, so 2 to 3 times the day's queries for a venue with zones.
- **Day status** ignores zones in this record; a day is `available` when any zone has a time.

This lifts the zone part of ADR-0017 section 2 ("No table or zone choice") for public zones only. Tables stay out of the public channel.

### Times grouped by service

The reference groups times by service. C40 forbids service names in public answers, because names can be internal. Options: no grouping (today); group by service only when the venue opts in with `showServiceNames` (default false); or group by time of day in the widget. Recommended: opt-in `showServiceNames`, which adds `service` to each entry of `slots` (Q3).

## 3. A public waitlist

### Options

| Option | For | Against |
| --- | --- | --- |
| A. No public waitlist | Nothing to abuse. | A full day ends the visit. |
| B. Join the staff waitlist with a date | One list for staff; reuses seating, erasure and retention. | The waitlist gains a date and a window, a contract change on staff routes. |
| C. A separate "booking request" store | No change to the staff waitlist. | Two lists for staff; another table to erase and retain. |
| D. Automatic offers and expiry | Fills tables alone. | Needs email or SMS, a hold, and expiry. Phase 12 back-fill. |

### Decision

Option B, off by default (`waitlistEnabled` in the online-booking settings), contract first.

**Route.** `POST /v1/public/{bookingKey}/waitlist` with an `Idempotency-Key` UUID, stored with the `public:` prefix of ADR-0017. A key used for a public create and then for a join fails with `invalid_request`, as for a key of another kind (C44, C58).

**Body: minimum data.** `name` (1 to 100), one `contact` that must normalize to an email (the join sends an email; the contract nests both as `guest.name` and `guest.contact`, as the public create does), `emailConsent` (required, must be `true`), `partySize` within the online limits, `date`, an optional `window` `{ from, to }` of local times, and the form challenge, solution and `honeypot` of the create (C45). No note and no marketing field. `emailConsent` covers email about this waitlist entry only and is never a marketing consent. The entry stores the time of the consent (`consent_at`) as proof. Erasure deletes the entry like any other waitlist entry (C5), so the proof goes with it (C78).

**What it accepts.** A date inside the effective window (C61, C62), served online that day, with waitlist on and the venue's email on (the same switch that gates the lost-link email, ADR-0017 stage 12). `waitlistEnabled` cannot be set while the venue's email is off. A date that is `closed` or `outside_window` fails with `waitlist_unavailable` (a new code, 409). The route does not require the day to be `full`: availability can change between read and submit, and a waitlist entry books nothing, so no second check is needed. The widget offers the button only on a `full` day or a service with no time.

**Abuse controls.**

- Challenge, proof of work and honeypot as the create (C45). Failures answer `invalid_request`.
- The route joins `public_booking` (per address) and `public_venue` (per venue), sharing their budgets with the create, so alternating routes gives no extra budget. A `400` or `404` returns the `public_venue` charge (ADR-0007 amendment).
- Per contact: at most 2 open public entries in the venue, and 1 per date. Per venue: at most 50 open public entries per date. Constants, not settings. Over any cap: `waitlist_unavailable`, the same answer as a closed date, so it does not say which cap was reached (Q7, C71). This replaces the earlier `online_booking_limit` for the per-contact caps.
- The guest blocklist of ADR-0018 applies, last, with `booking_declined`, only where the join would succeed (Q10).

**What the guest receives.** The entry as the guest sees it (date, window, party, venue name, masked contact) and a leave token. The token follows ADR-0017's rules: `<linkId>.<secret>`, SHA-256 hash only, constant-time compare, in the URL fragment, read from `X-Self-Service-Token`. It lives in a separate table, `waitlist_links`, so a booking token can never reach a waitlist route or the reverse. It expires at the end of the entry's date. Routes: `GET /v1/public/waitlist-entry` and `POST /v1/public/waitlist-entry/leave` (UUID key). Leave cancels the entry through the staff cancel and revokes the link in one transaction. Every failure gives one `404 self_service_link_invalid`. The page is `/r/waitlist`, served like `/r`. The join sends one email to the contact with the leave link, and the screen shows the same link. The consent wording and the email text wait for the legal review (Q11), so stage 12 does not ship before the owner confirms them.

**Ties to the staff waitlist.**

- Migration: nullable `date`, `window_start`, `window_end`, and `source` (`staff` or `widget`, default `staff`) on `waitlist`. A null date keeps today's meaning, the same-day queue.
- `waitlist.list` gains an optional `date` filter; without it, the answer is the entries with a null date or today's date, as staff see now. `WaitlistEntry` gains the four fields, so the MCP `waitlist_list` tool changes with it.
- `waitlist.seat` seats only an entry whose date is null or today, otherwise `invalid_transition`. Seating stays a walk-in now (C59).
- For a future date, staff call or write to the guest and book with the normal staff create. Then they remove the entry with the staff cancel. No `booked` status in v1 (Q8).
- Erasure by contact already deletes waitlist entries (C5). Retention deletes a public entry the day after its date, earlier than today's retention period, because it has no use after the date.
- Events: none. Waitlist writes emit no reservation event today, and this keeps it so.

**Not in v1.** Automatic offers when a table frees, holds, expiry of offers, SMS, back-fill on cancel or no-show (Phase 12 in `ROADMAP.md`), and the same-day QR join page (Phase 11). The QR page can later reuse this route with today's date.

## 4. Group requests

For a party above the online maximum the widget shows the phone and a short catalog text, and collects nothing. This is built (`party.largePhone`). The number comes from the public profile's phone, the one source the widget, the self-service page and JSON-LD already share. No new setting. A venue with no phone sees "call the venue" with no number, as today. A form that collects group details is rejected: it is a second channel with its own data, retention and legal text.

## 5. Summary and notice

- **Summary step.** Before the details form the widget shows date, time, party size, zone when one was chosen, and the venue address. Edit links go back to each step. It costs no request.
- **Address.** `PublicVenue` gains `address`, the street, postal code and locality of the public profile, or null. It is returned only while `publicProfileEnabled` is on, and is null otherwise (Q6, decided 2026-11-19). The phone keeps its rule: returned whenever the profile holds one. This reverses "No address" in ADR-0017 decision 4 for the profile's public address only. `noticeAddress` stays private.
- **Notice.** A new online-booking field `privacyNoticeUrl`, `https` only, up to 2048 characters, default null. When set, the widget shows a link next to the submit button with a catalog label such as "Privacy notice". We write no legal text. When null, the widget shows no notice link. Whether a booking without one is acceptable is for the legal review (ADR-0017 Q11).
- **Allergies and consent** stay as ADR-0017 decided: no allergy field, consent question only with `askConsent`, wording after the legal review (stages 8 and 11).
- **Rule: never pre-tick.** No widget build renders a consent or marketing checkbox ticked by default, and no public route records `granted` unless the request carries it. A widget test pins the unticked default. We believe EU rules do not accept pre-ticked boxes as consent; the legal review should confirm it. We state it as our design rule, not as a legal conclusion.
- **No double email field, no separate surname.** The form keeps one name and one contact (C55).

## 6. Staging

Each stage is one pull request. A contract stage changes `openapi.yaml`, `conformance.md` and `conformance-status.md` together, with the new cases as GAP.

| Stage | Flag | Depends on | Ships alone |
| --- | --- | --- | --- |
| 0 | This ADR, accepted. | none | yes |
| 1 | Contract: `/days`, its cases, the `public_days` rule in C52. | 0 | yes |
| 2 | API: `/days` on `publicTimes`, the rule, the agreement test. | 1 | yes |
| 3 | Widget: day strip and paged calendar on `/days`. | 2 | yes |
| 4 | Contract: `publicZones`, `PublicConfig.zones`, `slots`, `zone` on availability and create; amend C40, C42, C43. `showServiceNames` if Q3 says yes. | 0 | yes |
| 5 | API: zones on availability and create; the setting. | 4 | yes |
| 6 | Widget zone choice and Setup field. | 5 | yes |
| 7 | Contract: `PublicVenue.address`, `privacyNoticeUrl`. | 0 | yes |
| 8 | API and Setup: the two fields. | 7 | yes |
| 9 | Widget: summary step, notice link, the unticked-box test. | 8, and 6 for the zone line | yes |
| 10 | Contract: waitlist join, entry read, leave, `waitlist_unavailable`, the waitlist fields on staff routes and MCP. Done: C68 to C78. | 0 | yes |
| 11 | API: migration (with `consent_at`), join, the join email, `waitlist_links`, leave, seat rule, retention. Done: migration `0047`, `apps/api/src/lib/public-waitlist.ts`, the MCP `date` filter and the Setup switch; the join email's text is provisional until Q11. | 10 | yes |
| 12 | Widget: join on a full day with the unticked consent box, `/r/waitlist` page. Staff app: date and source on the waitlist. Done: `WaitlistJoin.tsx`, `WaitlistPage.tsx`, the date, window and source on the staff waitlist with a date filter. **Shipped off by default, with provisional wording:** the consent label and the email text still wait for the owner's confirmation after the legal review (Q11), the six non-Spanish widget translations also wait for native review, and the hosted demo template keeps the waitlist off until then. | 11, 3 | yes |

**PR #192.** Merge it as it is. Its behavior stays: open on the first bookable day and offer nearby free days. Stage 3 moves its requests from per-day `/availability` calls to one `/days` call, and removes the per-day loop in `nearby.ts`. Beyond the strip, the calendar pages `/days` on demand. The API serves the widget build from the same image (ADR-0017 stage 5 amendment), so no widget runs against an API without `/days`, and no fallback to per-day calls is kept.

## 7. Non-goals

Gift vouchers. Payments and deposits (Phase 12). Reserve with Google (Phase 14). AI and voice layers. Automatic waitlist offers (the entry's consent already covers email about it, but the hold and expiry are Phase 12). Wallet passes, see the section below.

## What this adds to each public route

New case ideas below take the next free id when their stage is written (C63, C64, C66, and C68 to C78 for the waitlist).

| Route | Request | Response | Case ideas | Rate rule |
| --- | --- | --- | --- | --- |
| `GET /v1/public/{bookingKey}` | unchanged | `zones`, `waitlistEnabled`, `privacyNoticeUrl`, `venue.address` | Zones empty with fewer than two public; address null when unset; no `noticeAddress`. | `public_read` |
| `GET .../days` (new) | `from`, `days` 1 to 14, `partySize` | `days[]` with `date`, `status`, `firstTime` | Agreement with `/availability` over a grid; each status; `days` bounds; party outside limits; no table, zone, service or count; unknown key 404. | `public_read` and `public_days` |
| `GET .../availability` | optional `zone` | `slots[]` with `time`, `zones` (and `service` if opted in) | `times` is the union; per-zone agreement with a create in that zone; unknown zone `invalid_request`; no zones without the setting. | `public_read` |
| `POST .../reservations` | optional `zone` | unchanged | Zone outside `publicZones` refused; booked table is in the zone; no zone behaves as today. | `public_booking`, `public_venue` |
| `POST .../waitlist` (new) | name, email contact, `emailConsent`, party, date, optional window, challenge, honeypot, UUID key | guest entry view and leave token | Idempotent replay; key-kind mismatch; `emailConsent` missing or false refused; a phone contact refused; a venue with email off refused; one email sent with the leave link and none on a refused join; closed day refused; caps per contact, per date and per venue; blocklist last; bot checks as C45; no reservation, event or table written. | `public_booking`, `public_venue` |
| `GET /v1/public/waitlist-entry` (new) | `X-Self-Service-Token` | guest entry view | Booking token refused; identical failures; expiry at end of date. | `public_read`, `self_service` |
| `POST /v1/public/waitlist-entry/leave` (new) | token, UUID key | cancelled entry view | Revokes in the same transaction; replay returns the result; the entry is `cancelled` and leaves the staff list, which shows `waiting` entries only. | `self_service` |

## Wallet passes, kept in mind

The owner asked to keep wallet passes in view because they are trending and can ease daily tasks (a booking reminder on the phone's lock screen, a waitlist status, a loyalty card later). This ADR does not build them. It avoids choices that would block them:

- The booking link and the waitlist leave link are already random tokens with only a hash stored. A pass would carry the same kind of link, so it needs no new identity.
- A pass changes when the booking changes, so it needs a way to push updates. The monotonic reservation version and the event feed already say what changed.
- Not verified here: the account, signing and update requirements of Apple and Google wallet passes, and whether a pass needs guest consent beyond the one for the booking email. Both need checking before a design.
- A ROADMAP entry and its own ADR come when the owner wants to start.

## Evidence and limits

- The reference widget is observed from screenshots only. We do not know its conversion rates or how its venues use it.
- No market study backs a claim that a day strip, zones or a waitlist raise bookings. This record does not make that claim.
- The way to validate is a measured before and after on a real venue: online bookings per widget view, the share of visits that end on a full day, waitlist joins and how many staff turn into bookings, with the same season on both sides.
- The DB cost figures are computed from the code path, not measured.

## Consequences

**Easier.** One request draws a strip. A guest on a full day can leave a name instead of leaving. A venue with a terrace can sell it online. The summary catches wrong dates before the form.

**Harder.** Public answers gain zones, possibly service names, and an address, so C40's scan changes. The waitlist gains a date and becomes two lists in one: today's queue and future requests. Staff must turn future entries into bookings by hand. A new token table and a new page.

**Accepted.** `/days` makes occupancy cheaper to scrape than today, bounded by `public_days`. Contacts on the waitlist are not verified, so caps per contact are weak, as ADR-0017 accepts for bookings. A waitlist join is limited to guests with an email, and the first email depends on the wording the legal review confirms.

**Changes to existing rules.** ADR-0017 section 2 "No table or zone choice" (zones only), ADR-0017 decision 4 and `PublicVenue` "no address", C40 (zone and service name), C42 (zones in the answer), C43 (`zone` in the create), C52 (new rule, waitlist route on two rules), C57 ("adding to the waitlist is not checked" stays true for staff only), and `WaitlistEntry` on staff routes and MCP.

## Alternatives considered

- **N calls to `/availability`, or a client cache.** Rejected for the strip, see section 1. Kept only as what PR #192 does until stage 3.
- **A range route that counts free covers.** Rejected. Counts leak occupancy and would be a second check.
- **Caching `/days` for 30 to 60 seconds.** Rejected. Stale `available` days cost the guest a failed booking.
- **All zones public.** Rejected: internal names.
- **A group request form.** Rejected, see section 4.
- **Waitlist with automatic offers now.** Deferred to Phase 12.
- **A separate request store instead of the waitlist.** Rejected: two lists for staff, two erasure paths.
- **Reusing `self_service_links` for waitlist tokens.** Rejected: a booking token must never name a waitlist entry, and that table's rows point to reservations.
- **Notice text written by the project.** Rejected: legal text waits for the review.

## Decided by the owner (2026-11-19)

- **Q2. Full versus closed.** Expose both. No per-venue switch in v1. A venue that asks to hide `full` gets one later.
- **Q4. No zone preference.** A create without `zone` uses every table, as today. Public zones only filter when the guest picks one.
- **Q9. Waitlist email.** The join sends email, and the guest has to accept it when joining: an unticked `emailConsent` box, required to join. This replaces the earlier proposal of no email in v1. The consent wording stays under the legal review (Q11).
- **Q10. Blocklist on the waitlist.** Applied to the public join, last, with the same answer a blocked public create gets, so the list does not reveal who is on it. C57's "adding to the waitlist is not checked" holds for staff adds only.
- **Q6. Address.** Only with `publicProfileEnabled`, the narrower reading, and not "whenever set" like the phone. A venue that did not enable its public profile did not choose to publish its address, and widening later is easy where retracting published data is not. The phone keeps its current rule, and whether it should follow the same one stays open. C64 specifies it.
- **Q3. Service names (2026-11-20).** Opt-in `showServiceNames`, default false: when on, public availability names the service of each slot; when off nothing about services appears, and C40 holds as before for that venue. C66 specifies it.
- **Q5. Zone labels (2026-11-20).** The guest sees the stored zone names in v1. A public label per zone and locale is a possible later addition. C66 specifies it.
- **Q7. Waitlist caps (2026-11-20, proposed default, owner to confirm).** Constants, not settings: 2 open public entries per contact, 1 per contact per date, 50 per date per venue. Over any cap the join fails with `waitlist_unavailable`, also for the per-contact caps, so the answer does not reveal which cap was reached. C71 specifies it.
- **Q8. Booking from an entry (2026-11-20, proposed default, owner to confirm).** No `booked` status. Staff book with the staff create and then cancel the entry; the guest's view then reads `cancelled`. `waitlist.seat` stays for an entry of today or with no date. C75 and C77 specify it.

## Open questions for the owner

- **Q1. Range.** 14 days per call with paging for the calendar, or up to 42 for a month in one call at 3 times the cost?
- **Q11. Legal review.** Placement of the notice link, whether a booking without `privacyNoticeUrl` is acceptable, consent wording, and confirmation that pre-ticked boxes are not valid consent under EU rules.

## Amendment 2026-11-23: where the open questions stand

Facts only. The status stays Proposed until the owner accepts the record.

- **Q7 (waitlist caps) is built as the proposed default.** The caps are constants: 2 open public entries per contact, 1 per contact per date, 50 per date per venue.
- **Q8 (booking from an entry) is built as the proposed default.** There is no `booked` status. Staff book with the staff create and then cancel the entry.
- **Q1 (range of `/days`) and Q11 (legal review) remain open.**
- **Stage 12 shipped** (`WaitlistJoin.tsx`, `WaitlistPage.tsx`, the date, window and source on the staff waitlist).
- **The public waitlist is off by default** (`waitlistEnabled: false`). A venue turns it on in Setup. The consent label and the join email text stay provisional until Q11.
