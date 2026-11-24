# ADR-0027: Allergies and dietary needs on a reservation

- Status: Proposed
- Date: 2026-11-24
- Deciders: David Cabeza (owner), and the legal reviewer for the questions below

Nothing in this record is built. It prepares the legal review of ROADMAP Phase 10 ("Allergies and diet: health data, blocked until a legal opinion of its own") with a concrete proposal and closed questions.

## Context

A guest who says "I am allergic to nuts" when booking gives the restaurant safety information. It has to reach the reservation and the kitchen. It is also health data, a special category under GDPR article 9. It needs a legal basis for processing (usually explicit consent), a retention period, erasure, and a minimum of access.

What exists today:

- No allergy or diet field. ADR-0003 keeps allergies and diet out of the guest record until a legal review. ADR-0017 decision 10 says the same for the public channel.
- The booking note `commentary` (REQ-N6) is free text up to 500 characters. The contract says it is not for health data.
- Issue #16 records the tension: safety on one side, health data governance on the other.

What an answer must respect, from the engine as it is:

- Erasure returns counts and keeps hashes, never personal values.
- Webhook payloads and events hold no guest data. Emails carry no text typed by a guest.
- Roles are `read`, `write` and `admin` (ADR-0009). The public channel exposes nothing about a booking except masked fields.
- There is no field-level encryption. The database holds data in clear, as for every other field. Whoever runs the instance and can read its database can read the field.
- The event trace records writes (who changed what and through which channel). Reads are not logged.

The trigger was a request from an integrator (a booking assistant that takes reservations through a messaging app), on 2026-11-24. It asked for a specific field, and for its shape, who sees it inside the restaurant, whether reads are logged, retention, editing after the booking, and whether the host of the instance can read it. Until an answer exists, it notifies the restaurant team out of band and does not write the allergy into the reservation. Its fallback is correct and stays valid if this ADR ends in "do not build".

## Decision (proposed, to confirm after the legal review)

1. **Per reservation, not per guest.** A reservation carries an optional `dietary` object. It is cleared with the reservation by the retention job and by erasure, exactly as `commentary` is. Nothing accumulates in a guest profile.
2. **Shape.** `allergens`: a list of codes from a closed list, the 14 allergens of Regulation (EU) No 1169/2011 Annex II (cereals with gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs). `note`: optional text, trimmed, at most 200 characters, for what the list cannot say ("intolerance to onion"). Absent means nothing was declared. An unknown code or a longer note fails with `invalid_request`.
3. **Who writes.** Staff, or a key with `write`, on create, walk-in and modify. The public booking widget does not collect it in this ADR: that needs the consent wording of the review (ADR-0017 stage 11).
4. **Who reads.** The same roles that read the reservation, in `get`, in the agenda and in the pre-shift view. Never in webhooks, events, emails, logs, the public channel, the guest's own self-service view, or answers that list many reservations (list, search). A kitchen-only view is a later decision (Q2).
5. **Audit.** A change emits the usual `modified` event, which names the field and carries no value. Reads are not logged (Q5).
6. **Retention and erasure.** The value lives as long as the reservation does and is erased with it (Q3).
7. **Contract first.** A conformance case and the `openapi.yaml` text land before the code (CLAUDE.md).

## Questions for the owner and the legal reviewer

Each can be answered yes or no, or by choosing an option.

1. **Basis.** Is explicit consent (article 9(2)(a)) the basis, collected by the person who takes the booking, or is another basis available to the restaurant? Who is the controller, the restaurant or the product operator?
2. **Visibility.** May every staff role see the value? Is a separate kitchen role required before this ships?
3. **Retention.** Is "as long as the reservation, then erased" enough, or must the value go sooner (for example after the service day)?
4. **Encryption.** Is field-level encryption required, or are the database and disk protections enough?
5. **Read logging.** Must the system record who read the value?
6. **Public channel.** May the booking widget collect it, and with what consent wording?
7. **Hosting.** Does an operator who hosts an instance for restaurants become a processor of health data, and what agreement does it need?
8. **Closed list.** Is the closed list plus a short note acceptable, or must the free text be refused?

## Consequences

If accepted: the kitchen gets a safe place for the information, with no new standing data about people. The engine takes on health data, so it needs the review, a retention rule, and a documented answer to "who can read this" for each deployment.

Harder: the field is one more thing that erasure, retention, the demo template (CLAUDE.md rule: a feature adds itself to `apps/api/src/demo/template.ts`, with invented data only) and the hosted demo's terms (which forbid real health data) must cover.

## Alternatives considered

- **A health profile on the guest record.** Rejected for a first version. It accumulates data across visits, makes erasure and retention harder, and is the form ADR-0003 postponed.
- **Free text only.** Rejected. It is unstructured, cannot be validated, and silently becomes health data with no governance. It is what the contract forbids in `commentary`.
- **A neutral reference in `commentary`, with the health data kept in the integrator's own system.** Valid and available today. The contract allows a reference with no health data. It keeps the engine out of health data entirely, at the cost of the kitchen having to look in a second place. It stays the fallback if the review says "do not build".
- **Do not build it.** An outcome the review may reach. Then the contract keeps "not for health data" and the ROADMAP item closes.
