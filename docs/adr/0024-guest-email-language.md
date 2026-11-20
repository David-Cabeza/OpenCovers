# ADR-0024: The guest's language in emails and links

- Status: Proposed
- Date: 2026-11-21
- Deciders: David Cabeza

Nothing in this record is built. It proposes how guest emails follow the language the guest booked in, so that the contract (`docs/contract/openapi.yaml`), the conformance cases and the code can follow, in that order. It changes rules of [ADR-0017](0017-booking-widget-and-self-service-link.md) and [ADR-0021](0021-widget-day-status-zones-waitlist.md), listed under Consequences. Open questions for the owner are marked `Q1` to `Q7`.

## Decisions at a glance

| # | Question | Recommended | Main alternative rejected |
| --- | --- | --- | --- |
| 1 | Where the language comes from | The widget sends the locale it shows as an optional `locale` on the public create, one of the seven. The reservation stores it in a nullable `guest_locale`. Erasure and retention reset it to null. Staff bookings store null and use the venue's locale. | The venue's locale only (today). |
| 2 | Which messages use it | Every email to the guest: confirmation (also sent after a change), cancellation, the `self_service_link` email, the lost-link resend, the guest-cancel notice, and the waitlist join email. Every `/r` link carries `lang=<stored locale>`. The venue's `notice` stays in the venue's locale. | Localizing only the confirmation. |
| 3 | How templates are localized | One catalog per locale in `apps/api`, next to the mailer, same ids and slots, a parity test. Plain text only. Fallback: stored locale, then venue locale, then `es`. No venue-editable text. Every translation is a draft until a native review, and the legal review covers each language. | Sharing the widget's catalog. |
| 4 | Contract and data impact | One optional request field, one nullable read field, one migration, amended cases C5, C18, C43, C51, C55, one new case C67. Nothing breaking. | A new event field or webhook field. |
| 5 | Staging | Six stages, contract first. The catalog stage ships alone and comes before ADR-0021's join email. | One PR for all of it. |
| 6 | Non-goals | Venue-editable templates, SMS, per-recipient time zones, guessing a language from an email domain. | |

## Context

A guest who books through the widget in English or French receives a Spanish email. What the code does today, read on `origin/main` at `c5e423b`:

- `buildEmail(kind, c)` in `apps/api/src/lib/mailer.ts` takes no locale. Its three kinds, `confirmation`, `cancellation` and `notice`, are hard-coded Spanish placeholders. The comment says the wording and legal basis are pending review.
- `notifyReservation` in `apps/api/src/lib/notifications.ts` reads the venue and the reservation and calls `buildEmail` with the date, time, party size, guest name and service. No locale is read or passed. The date is the raw `YYYY-MM-DD`; the time is `formatTime` in the venue's zone.
- A modify sends `confirmation` again (`apps/api/src/app.ts`, lines 335 and 1017). There is no separate change kind, so a change reads "tu reserva está confirmada".
- `buildLinkEmail(lines)` in the same file builds the lost-link email, in Spanish. `resendLinks` in `apps/api/src/lib/link-resend.ts` builds each link as `/r?lang=<settings.locale>#<token>`, the venue's locale, because the request carries only an address (ADR-0017, stage 12 amendment).
- The reservation stores no language. `reservations` in `apps/api/src/db/schema.ts` has no locale column, nor does `guests`. `sent_emails` holds venue, reservation, kind and version only.
- The "venue locale" is `locale` in the online-booking settings (`venue_online_booking`, check constraint on the seven codes, default `es`). C39 says a venue that never set it reads `es`.
- `LOCALES` in `apps/api/src/lib/online-booking.ts` is `es`, `en`, `ca`, `fr`, `de`, `it`, `pt`. `apps/api/test/locales.test.ts` checks it equals `SELF_SERVICE_TITLES` (`apps/api/src/lib/widget-page.ts`) and the widget's `CATALOGS` (`apps/widget/src/messages.ts`).
- The widget catalogs are `Record<MessageId, string>` with `MessageId = keyof typeof es`, all in one file. The widget picks its locale from `<html lang>`, which the API sets from a supported `?lang=` or the venue's locale (`apps/widget/src/main.tsx`, C41). Its confirmation screen already builds the `/r` link with the locale it shows (`selfServiceUrl` in `App.tsx`).
- `embed.js` passing the host page language as `?lang=` is commit `249e8c4` on branch `feat/embed-host-language`. It is not on `origin/main` at `c5e423b`.
- `parsePublicCreate` in `apps/api/src/lib/public-booking.ts` refuses a fixed list of fields and ignores other unknown fields. A `locale` sent today is ignored.
- ADR-0017 stage 8 (the link in the confirmation, the `self_service_link` email on replay and reissue, the guest-cancel notice) is not built. C43 and C51 are PARTIAL for that reason (`conformance-status.md`). So today only the resend email carries a `/r` link.
- ADR-0017's stage 15 amendment says the email templates stay as they are, so an email is not localized. REQ-N2 keeps email off per venue until the text and basis pass legal review; `notificationsEnabled` is off by default.
- No reminder email exists (`grep reminder` in `apps/api/src` finds nothing), though REQ-N2 names one.
- ADR-0021 section 3 sends one email with the leave link when a guest joins the public waitlist. The join email is in its stage 11 (API); stage 12 is the widget and waits for Q11 there.

## Decision drivers

- **Minimum guest data.** Store only what an email needs, and nothing a stranger could use to reach the guest.
- **What the guest saw is what the guest gets.** The email follows the language of the screen the guest booked on.
- **No legal text from us.** Every template stays a placeholder until the legal review (REQ-N2, REQ-N4, ADR-0021 Q11).
- **Contract and conformance first.** Each behavior below lands as a case before code.

## 1. Where the language comes from

### Options

| Option | For | Against |
| --- | --- | --- |
| A. Venue locale only (today) | Nothing to store. | A guest on an English page gets Spanish mail. Defeats `?lang=` and `embed.js`. |
| B. `locale` on the public create, stored on the reservation | It is exactly what the guest saw. One small column. | One field and one migration. |
| C. `Accept-Language` at create | No body change. | It is the browser's setting, not the widget's language. A guest who read the page in Spanish could get German mail. Varies per request. |
| D. A preference on the guest record | One value for all bookings. | Anyone who books with a contact would overwrite that guest's language. Merges and unmerges must reconcile it. Guest records exist per venue only when the contact normalizes. |

### Decision

Option B. The public create takes an optional `locale`, exactly one of the seven lower-case codes. Any other value, `null` or a non-string fails with `invalid_request` and writes nothing, like any malformed field. An absent `locale` stores null. The widget always sends the locale it is showing, which is the `localeOf(<html lang>)` it renders with.

The reservation stores it as `guest_locale`, nullable text, with a check constraint on the seven codes. It is written once, at create. A replay of the create key (C44) changes nothing, whatever `locale` the replay sends. A guest modify through `/r` does not change it in v1 (Q4).

**Minimum data.** A language code is not contact data: it cannot reach anyone and holds no free text. It is still a fact about a person while it sits next to their booking. Erasure and retention therefore reset it to null in `eraseReservations` (`apps/api/src/lib/venue.ts`), as they reset consent to `unknown` (REQ-N4). Erasure counts do not change, and no hash of it is kept, since nothing needs to match on it later.

**Staff bookings.** A booking made by the staff app, the API or MCP has no guest language and stores null, so the venue's locale applies. Letting staff set it (a phone booking from a French guest) is a separate, optional stage (Q2). If built, staff create and modify take `guestLocale` under the same rule, a change bumps the version and emits `modified` like the note (C23), and sends no email.

## 2. Which messages use it

| Message | Recipient | Language | Link |
| --- | --- | --- | --- |
| `confirmation`, at create and after a change | guest | stored, then venue | `/r?lang=<stored>#<token>` when stage 8 adds the link |
| `cancellation`, staff or guest | guest | stored, then venue | none (the cancel revokes it) |
| `self_service_link` (replay, reissue; ADR-0017 stage 8) | guest | stored, then venue | `/r?lang=<stored>` |
| `self_service_link_resend` | guest | the earliest matched booking's stored locale, then venue | each link carries its own booking's stored locale |
| Waitlist join (ADR-0021 stage 11) | guest | the join's `locale`, then venue | `/r/waitlist?lang=<locale>` |
| `notice` | venue | venue | none |
| Reminders | none exist | would follow the stored locale | |

**The resend.** One email may name up to 5 bookings, possibly booked in different languages. The text uses the locale of the earliest matched booking, the one whose stored address the email goes to. The request's own language is not used: anyone can type an address, so the requester must not choose any part of what the guest receives.

**The waitlist.** ADR-0021 sends one email, at join, while the request is in memory. The join body takes the same optional `locale`, used for that email and the leave link only. The entry stores no language in v1, so erasure has nothing new to drop. A later waitlist email would need a column under the rules of section 1.

## 3. How templates are localized

### Options

| Option | For | Against |
| --- | --- | --- |
| A. One catalog per locale in `apps/api`, next to the mailer | Same pattern as the widget. The API owns its text. A test keeps parity. | A second set of catalogs to translate. |
| B. Share the widget's `messages.ts` | One file to translate. | The API would import from another app, and email text would ship in the widget bundle. |
| C. Venue-editable templates | Venues write their own text. | Venue text in a guest's inbox, a review burden, and the legal review cannot cover it. |

### Decision

Option A. A new `apps/api/src/lib/email-messages.ts` holds `EMAIL_CATALOGS = { es, en, ca, fr, de, it, pt }`, typed `Record<EmailMessageId, string>` with ids from `es`. `buildEmail` and `buildLinkEmail` take a resolved locale and read from it. Rules:

- **Same ids and slots.** A test checks every catalog has the keys of `es` and the same `{slot}` names, as `apps/widget/test/messages.test.ts` does. `apps/api/test/locales.test.ts` adds `EMAIL_CATALOGS` to the lists that must equal `LOCALES`.
- **Plain text.** `sendEmail` sends `text` only today. v1 keeps that. HTML is a later change.
- **Formatting.** The date is formatted with `Intl.DateTimeFormat` in the resolved locale, from the calendar date, so the day never shifts. The time stays `formatTime` in the venue's zone.
- **Fallback.** Stored locale, then the venue's online-booking `locale`, then `es`. A value outside the catalogs (a future column value with no catalog) falls through the chain and never throws.
- **Unchanged rules.** No guest name in emails to the guest (C61). No note or other typed text. The once per reservation, kind and version rule of `sent_emails` and the guest-modify limit are untouched.
- **No venue-editable text** in v1, as for the widget.

**Who writes the translations.** The project drafts all seven. A draft may be machine-assisted. Each catalog is marked a draft until a native speaker reviews it (Q3). The legal review of REQ-N2 and of the consent wording (REQ-N4, ADR-0021 Q11) must cover each language it is sent in. This record does not claim any translation, Spanish included, is legally approved.

## 4. Contract and data model

| Place | Change | Breaking |
| --- | --- | --- |
| `PublicReservationCreate` | Optional `locale`, enum of the seven codes. | No. Optional, and older APIs ignore it. |
| `Reservation` (staff reads) | Read-only `guestLocale`, nullable, same enum. | No. A new nullable field. |
| `ReservationCreate`, `ReservationModify` | Optional `guestLocale` only if Q2 says yes. | No. |
| Waitlist join body (ADR-0021 section 3) | Optional `locale`. Written into ADR-0021 stage 10. | No. Not built yet. |
| C43 | A create with `locale` stores it; an unsupported value fails with `invalid_request`; without it the booking reads null. | |
| C55 | Adds the language code to what the public channel takes. | |
| C5, C18 | Erasure and retention reset `guestLocale` to null. | |
| C51 | The resend's text and each link follow the stored locale, not the venue's. | |
| C67 (new) | Email language: each guest kind in the stored locale, the fallback chain, the venue's `notice` in its locale, and catalog parity. | |
| Migration | `guest_locale text` nullable with a check on the seven codes, by `pnpm db:generate`. Adding a locale later changes the check, as migration `0038` did for the venue. | No. Existing rows read null. |
| Events, webhooks | Unchanged. Payloads stay free of guest data. | |
| MCP | `reservation.get` and lists return API reads, so `guestLocale` shows up there. The create and modify tools' zod schemas gain it only with Q2. | No. |
| Demo template | No new setting or screen unless Q2 adds a staff field. Then two template bookings get a non-`es` language so the hosted demo shows it (ADR-0022). | |

## 5. Staging

Each stage is one pull request. A contract stage changes `openapi.yaml`, `conformance.md` and `conformance-status.md` together, with new cases as GAP.

| Stage | Flag | Depends on | Ships alone |
| --- | --- | --- | --- |
| 0 | This ADR, accepted. | none | yes |
| 1 | Contract: `locale` on the public create, `guestLocale` on reads, amend C5, C18, C43, C51, C55, add C67. | 0 | yes |
| 2 | Email catalogs: `email-messages.ts` with all seven drafts, locale-aware `buildEmail` and `buildLinkEmail`, the parity test. Callers still pass the venue's locale, so a venue whose locale is `en` already gets English mail. | 0 | yes |
| 3 | API: migration, store `locale` at create, reset on erasure and retention, `notifyReservation` and `resendLinks` use the stored locale. | 1, 2 | yes |
| 4 | Widget: send `locale` on the create. | 3 | yes |
| 5 | Optional (Q2): staff field on create and modify, staff app control, MCP schemas, demo template. Contract first within the PR. | 3 | yes |
| 6 | ADR-0021 stage 10 gains `locale` on the join body; its stage 11 join email uses the stage 2 catalogs. | 2 | with ADR-0021 |

ADR-0017 stage 8 needs only stage 2 to send its new emails localized. Its link in the confirmation uses the stored locale once stage 3 is in. Stage 2 also removes the long dash from today's subject lines.

## 6. Non-goals

Venue-editable templates. SMS. Formatting times in the guest's own time zone (times stay in the venue's zone, as today). Guessing a language from the contact's email domain or phone prefix. A language switch inside the widget. Localizing the staff app or the venue's `notice`.

## Evidence and limits

- Nothing here is measured. There is no data on how many guests book in a language other than the venue's.
- Verified in code at `c5e423b`: the files cited in Context, the create route in `apps/api/src/app.ts`, the erasure path in `apps/api/src/lib/venue.ts`, the MCP tool schemas in `apps/mcp/src/index.ts`, and the demo template.
- Not verified: that the production Node image has full ICU, so `Intl` dates in `ca` or `pt` read correctly. Stage 2 should pin one formatted date per locale in a test.
- Not verified: whether Resend or receiving clients need a `Content-Language` header. Not proposed here.
- The branch with `embed.js` passing `?lang=` was read, not run. The widget's handling of `?lang=` on `/w` is on `main` and covered by C41.

## Consequences

**Easier.** A guest gets mail in the language they booked in. Links in mail open `/r` in that language. Adding a locale is one catalog per app plus the lists the parity test reads.

**Harder.** Seven email catalogs to keep in step with the widget's. The legal review grows from one language to seven. A new nullable column joins the erasure path.

**Accepted.** A stranger who books with someone's address chooses the language of the mail it sends, as they already choose the booking. A staff booking reads in the venue's language until Q2. A guest who books in one language and manages the booking in another keeps the first for mail.

**Changes to existing rules and conflicts.**

- ADR-0017, stage 15 amendment: "an email is not localized by this stage". This record localizes them.
- ADR-0017, stage 12 amendment, and C51: the resend link uses the venue's locale "because the request carries only the address". The link now uses the stored locale, and the email text is no longer only Spanish ("It is in Spanish, like the other templates").
- C55 lists what the public channel takes. It gains the language code.
- C5 and C18 list what erasure and retention reset. They gain `guestLocale`.
- ADR-0021 section 3 lists the join body as minimum data. It gains an optional `locale`. The join email is in ADR-0021 stage 11, not stage 12.
- C43 says the confirmation carries the self-service link. The code does not yet (stage 8), so "every `/r` link carries the stored locale" applies today to the resend email only.

## Alternatives considered

- **Venue locale only.** Rejected: it ignores what the guest saw.
- **`Accept-Language`.** Rejected: it is not the widget's language.
- **A language on the guest record.** Rejected for v1: anyone booking with a contact would overwrite it, and merges must reconcile it (Q1).
- **The resend request's own language.** Rejected: the requester may not be the guest and must not shape the email.
- **Sharing the widget catalog.** Rejected: cross-app import and email text in the widget bundle.
- **HTML email now.** Deferred: today's mailer sends plain text, and HTML doubles what the legal review reads.
- **Ignoring an unsupported `locale` instead of refusing it.** Rejected: every other public field is strict, and the widget only sends the seven.

## Open questions for the owner

- **Q1. Booking or guest.** Store the language on each booking (recommended) or as a preference on the guest record?
- **Q2. Staff control.** Should staff, the API and MCP be able to set or change a booking's language, for phone bookings? If yes, stage 5 ships.
- **Q3. Draft translations.** Ship machine-assisted drafts of all seven catalogs before a native review, marked as drafts in the file, or ship only reviewed locales and fall back to `es` for the rest?
- **Q4. Language through the link.** Should a guest modify through `/r` update the stored language to the page's `lang`?
- **Q5. Legal review scope.** Does the REQ-N2 review cover each language's email text and the waitlist consent wording in each language, and who signs off per language?
- **Q6. The venue's notice.** Keep `notice` in the venue's online-booking locale, or follow a staff app language when that exists?
- **Q7. Reminders.** REQ-N2 names a reminder that is not built. Should its stage reference this record so it is localized from the start?
