# Guest emails

Moved from the roadmap. A reference to a "Phase" points to the numbered phase list the roadmap used until 2026-11-23, which stays in the file's history.

A reservation product sends a guest a set of emails over the life of a booking. The table lists each one, what sends it, and where OpenCovers stands. A row that is not built is open work. Every built email is off until the venue turns email on.

| Email | Sent when | Status | Depends on |
| --- | --- | --- | --- |
| Confirmation | A booking is made, on any channel. | Built. Placeholder text pending legal review. | REQ-N2. The self-service link in it is blocked on legal (ADR-0017 stage 8). |
| Modification | The date, time, or party size changes. | Built. Placeholder text pending legal review. A guest's own changes send at most 3, 15 minutes apart. | REQ-N2. |
| Cancellation by the guest | The guest cancels with the self-service link. | Built. Placeholder text pending legal review. | REQ-N2. The venue's notice of a guest cancel waits for ADR-0017 stage 8. |
| Cancellation by the venue | Staff or a platform cancels. | Built, with the same text as a guest cancel. Placeholder text pending legal review. | REQ-N2. |
| Reminder | A set time before the visit. | Planned in Phase 13. The calendar file in the confirmation already sets an alarm 2 hours before. | ADR-0024 catalogs, consent enforcement, REQ-N2. |
| Reconfirmation request | A set time before the visit, to ask the guest to confirm. | Planned in Phase 12. The status exists, and staff or a platform set it by hand (C25). | A way for the guest to answer. REQ-N2. |
| Second confirmation | The guest confirms the booking again. | Planned in Phase 12, with the reconfirmation messages. | The reconfirmation request. |
| No-show notice | Staff mark the booking `no_show`. | Not planned on its own. The Phase 12 no-show charge needs it. | Phase 12 payments. REQ-N2. |
| Waitlist table ready | A table frees up for a waiting party. | Planned in Phase 11. | The widget join page and `/r/waitlist` (ADR-0021 stage 12) are built, off by default. SMS needs the Phase 13 provider interface. |
| Request received | A booking waits for staff approval. | Blocked on a decision. ADR-0017 stage 14 is deferred, and `confirmationMode: approval` is reserved. | A `pending` status, which changes REQ-B6. |
| Post-visit survey and review request | The visit is over. | Planned in Phase 13. | Granted consent. REQ-N2. |
| Waitlist join | A guest joins the public waitlist. | Built (ADR-0021 stage 11), and the widget join that triggers it (stage 12), off by default. Placeholder text pending legal review. | C70. |
| Self-service link | The guest asks for a new link. | Built (ADR-0017 stage 12). Placeholder text pending legal review. | REQ-N2. |
| Birthday | The guest's birthday comes near. | Blocked. | Data the product does not store (a date of birth, a guest identity across bookings) and marketing consent. See the [guest-data design rule](README.md#design-rules). |
| Welcome | A guest signs up to hear from the venue. | Blocked. | Data the product does not store (a guest identity across bookings) and marketing consent. See the [guest-data design rule](README.md#design-rules). |

Two more emails are built and go to people other than the guest: the venue's notice of a new booking, and the sign-in link of the hosted demo.
