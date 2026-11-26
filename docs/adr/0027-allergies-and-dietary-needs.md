# ADR-0027: Allergies and dietary needs on a reservation

- Status: Accepted (engine, HTTP API and staff app built; MCP tools and demo not built)
- Date: 2026-11-24, accepted 2026-11-26
- Deciders: David Cabeza (owner). The legal reviewer still answers the questions below before any use with real guests.

The owner accepted this record on 2026-11-26. Step 1, this record and the contract (`docs/contract/openapi.yaml`, `docs/contract/mcp.md`, conformance case C82), is written, and step 2, the engine and HTTP API, is built. C82 is partial in `docs/contract/conformance-status.md` until the MCP tools take the field. The later steps are listed at the end.

## Context

A guest who says "I am allergic to nuts" when booking gives the restaurant safety information. It has to reach the reservation and the kitchen. It is also health data, a special category under GDPR article 9. It needs a legal basis for processing (usually explicit consent), a retention period, erasure, and a minimum of access.

What exists before this record:

- No allergy or diet field. ADR-0003 kept allergies and diet out of the guest record until a legal review. ADR-0017 decision 10 said the same for the public channel. Both are amended on 2026-11-26 to point here.
- The booking note `commentary` (REQ-N6) is free text up to 500 characters. The contract says it is not for health data, and that rule stays.
- Issue #16 records the tension: safety on one side, health data governance on the other.

What an answer must respect, from the engine as it is:

- Erasure returns counts and keeps hashes, never personal values.
- Webhook payloads and events hold no guest data. Emails carry no text typed by a guest. A `modified` event carries ids, a type and a version, and does not name the fields that changed.
- Roles are `read`, `write` and `admin` (ADR-0009). There is no kitchen role. The public channel exposes nothing about a booking except masked fields.
- There is no field-level encryption. The database holds data in clear, as for every other field. Whoever runs the instance and can read its database can read the field.
- The event trace records writes (who changed what and through which channel). Reads are not logged.
- An idempotency key stores the reservation id and the version, not the request body. A replay reads the reservation as it is now.
- The staff create, walk-in and modify routes ignore a body field they do not know. Until C82 is built, a `dietary` sent to them is dropped without an error.

The trigger was a request from an integrator, Widdot, a booking assistant that takes reservations through a messaging app, on 2026-11-24. It asked for a specific field, and for its shape, who sees it inside the restaurant, whether reads are logged, retention, editing after the booking, and whether the host of the instance can read it. Until the field is built and turned on, it notifies the restaurant team out of band and does not write the allergy into the reservation. That fallback stays correct.

## Owner decisions, 2026-11-26

These are the owner's decisions, recorded on 2026-11-26.

1. **Build it now. The legal review is not replaced.** The engine gets the field although the legal review of health data (the questions below) is still pending. The review still gates any use with real guests. No instance may turn the switch on for real guests before the review answers, and the hosted demo turns it on with invented data only (decision 4).
2. **The guest gives the information, affirmatively.** The guest states the allergy or diet and agrees to its use. In the integrator's channel the assistant asks for permission first. The integrator's proposed wording, pending legal review, is:

   > «Para atenderte con seguridad necesito tu permiso para usar este dato de salud: «Soy alérgica a los cacahuetes». Si dices SÍ, el restaurante lo anotará en tu reserva y lo verá su equipo de sala y cocina. Lo usaremos solo para esta reserva. Puedes retirarlo cuando quieras escribiendo «borrad mi alergia». Si dices NO, no lo anoto y te atenderá una persona del equipo. ¿Me das tu permiso? Responde SÍ o NO.»

   Facts for the reviewer:
   - The wording says the floor and kitchen team ("sala y cocina") sees the value. There is no kitchen role today. Every staff role of the venue (`read`, `write`, `admin`) and every API key that can read the venue sees it, integrators' keys included.
   - The wording names only health data ("este dato de salud"). A diet code of `halal` or `kosher` can reveal religious belief (decision 6).
   - The wording does not say that an MCP client may pass the value to an AI provider (decision 5).
   - "Borrad mi alergia" reaches the engine as a modify with `dietary: null`, which the integrator or staff send. The engine has no guest-facing withdrawal.
3. **An instance switch, off by default.** The environment variable `DIETARY` takes `on` or `off`, like `MCP_REMOTE`. Unset means `off`. Any other value stops the API at startup. With it off:
   - A create, walk-in or modify whose body holds a `dietary` object fails with `invalid_request`, writes nothing and stores no idempotency key. `dietary: null` is still accepted, so a withdrawal always works.
   - No answer carries `dietary`, MCP included.
   - `GET /v1/venues/{venueId}/config` reads `dietaryEnabled: false`. This is how an integrator tells "the instance does not take the field" from "my body is wrong", without parsing a message. It reads the flag before it asks the guest, and when the flag is not `true` it keeps notifying the venue out of band. Before C82 is built the flag is absent, which means the same.
4. **The hosted demo turns it on, with invented data only.** The demo terms forbid real health data and keep doing so. The staff app shows that rule next to the field in the demo. The demo's changes are later steps (see "Later steps").
5. **MCP carries it.** The MCP server accepts `dietary` on `reservation.create`, `reservation.walk_in` and `reservation.modify`, and returns it wherever the HTTP API returns it. With the switch off, MCP neither takes nor returns it, because it wraps the HTTP API. The value then reaches the AI provider behind the MCP client, a third party that the proposed wording does not mention. The legal review must answer whether the wording has to change (question 9).
6. **Allergens and diets, both closed lists.** Besides the allergens, staff pick diets from a closed list, shown as buttons in the staff app. The proposed diet codes are `vegetarian`, `vegan`, `halal` and `kosher`. The list waits for the owner's confirmation. There is no `gluten_free` or `lactose_free`: the allergens `gluten` and `milk` cover them. `halal` and `kosher` can reveal religious belief, which is itself a special category under GDPR article 9. The proposed wording speaks only of health data, so the reviewer has to change it (question 10).
7. **Consent is attested on every write.** A `dietary` object must carry `"consented": true`. With it, the writer attests that the guest authorized this use. Staff who take a booking by phone attest the same. Without it, or with any other value, the write fails with `invalid_request`. The engine stores when the value was recorded and by which principal.

## Decision

1. **Per reservation, not per guest.** A reservation carries an optional `dietary` object. Nothing accumulates in a guest profile. The guest record of ADR-0003 holds none of it.
2. **Shape of a write.**

   ```json
   {"allergens": ["peanuts"], "diets": ["vegetarian"], "note": "intolerance to onion", "consented": true}
   ```

   - `allergens`: optional, a list of codes from the 14 allergens of Regulation (EU) No 1169/2011, Annex II: `gluten` (cereals containing gluten), `crustaceans`, `eggs`, `fish`, `peanuts`, `soybeans`, `milk`, `nuts` (tree nuts), `celery`, `mustard`, `sesame`, `sulphites`, `lupin` and `molluscs`.
   - `diets`: optional, a list of codes from `vegetarian`, `vegan`, `halal` and `kosher` (list pending the owner's confirmation).
   - `note`: optional text for what the lists cannot say, such as "intolerance to onion". The engine trims it. After trimming it holds at most 200 characters. An empty note after trimming counts as no note.
   - `consented`: required, exactly `true`.
   - A repeated code is kept once.
   - An unknown code, a list that is not a list of strings, a note that is not a string, is longer than 200 characters or holds a NUL or an unpaired surrogate, a missing or non-`true` `consented`, and a key the object does not list fail with `invalid_request`.
   - An object with no allergen, no diet and no note (`{"consented": true}` or `{"allergens": [], "consented": true}`) fails with `invalid_request`. To clear the value, send `null`.
3. **Shape of a read.** `allergens` and `diets` are always present, possibly empty, each in the order of its list above. `note` is the trimmed note, or an empty string. `consented` is `true`. `recordedAt` is when the value was last set. `recordedBy` names who set it, with the label rules of the trace's `actor`: a member's display name for a staff session (null when it is not known), and `key_` plus 12 hex characters for a key. A reservation with no value has no `dietary` key.
4. **Absent means nothing declared.** It never means "no allergies". An absent value can also mean the switch is off or the answer is one that never carries the field. No surface may say "no allergies", "none" or an equivalent. The staff app shows nothing when the field is absent.
5. **Who writes.** Staff, or a key with `write` or `admin`, on `POST /v1/venues/{venueId}/reservations` (create), `POST /v1/venues/{venueId}/reservations/walk-in` and `POST /v1/venues/{venueId}/reservations/{reservationId}/modify`. A `read` key or role fails with `forbidden`. On create and walk-in, `null` means the same as no field. A seat from the waitlist does not take it. The public channel and the self-service link do not take it: a body that names `dietary` on `POST /v1/public/{bookingKey}/reservations` or `POST /v1/public/self-service/modify` fails with `invalid_request`.
6. **Modify.** An omitted `dietary` leaves the value unchanged. `null` clears it, with its `recordedAt` and `recordedBy`. An object replaces the whole value and sets `recordedAt` and `recordedBy` again. An object is accepted on `booked`, `seated` and `attended`, as `commentary` is. A modify whose only field is `dietary: null` is accepted on every status, `cancelled` and `no_show` included, so a withdrawal always works. That is the one exception to C4. A change bumps the version by one and emits one `modified` event, which carries no value. A value equal to the stored one (the same codes and the same trimmed note) changes nothing and keeps `recordedAt` and `recordedBy`. `null` on a reservation with no value changes nothing. A modify with only `dietary` sends no email.
7. **Who reads.** Any key or role that can read the venue, in these answers only:
   - `GET /v1/venues/{venueId}/reservations/{reservationId}` (`reservation.get`).
   - `GET /v1/venues/{venueId}/agenda` (`reservation.agenda`). The staff app's pre-shift view and floor plan have no route of their own. The pre-shift view reads the agenda, and the floor card reads `reservation.get`.
   - The reservation returned by create, walk-in, modify, cancel (`POST .../cancel`) and status (`POST .../status`).

   The agenda is its own route, not the list or the search. `GET /v1/venues/{venueId}/reservations` (`reservation.list`) and `GET /v1/venues/{venueId}/reservations/search` (`reservation.search`) never carry the field, so a range query over many days does not return health data. MCP follows the same routes.
8. **Never carried.** Webhook payloads, the event feed, the trace, emails, logs, `guest.get` and the guest list, the erasure answer, every route under `/v1/public/` (the self-service view included), the widget, and the list and search answers. The API never logs a request body that holds it.
9. **Idempotency.** The key stores ids and a version, not the value. A replay returns the reservation as it reads now, with its current value, and applies nothing of the replayed body, as for every other field. A modify that carries `dietary` and changes nothing keeps its key too (added while building step 2): without it, a late retry would restore a withdrawn value or clear a newer one. With the switch off, a body with a `dietary` object fails with `invalid_request` before the key is looked up, as any invalid body does.
10. **Retention and erasure.** The value lives as long as the reservation's guest data does. Retention clears it when it blanks the reservation, as it clears `commentary`. A reservation with only a `dietary` value and no name, contact or note also expires once its end is older than the venue's retention period. Erasure by guest id and by principal clears it. The erasure answer keeps its counts and adds no value and no new count. The `erased` event carries only the tombstone hash.
11. **The switch off keeps stored values, hidden.** Turning `DIETARY` off does not delete stored values. They are not returned while it is off, and turning it back on shows them again. They are still cleared by `dietary: null`, by retention and by erasure. With the switch off, the API logs at startup the number of reservations that hold a value, never a value. The reason: a deploy that loses the variable must not wipe the next service's allergies. An operator who turns it off for good clears the values with `null` modifies or waits for retention.

    **The config says that values are hidden (added 2026-11-26).** With the values hidden the staff app has nothing to show, which reads as nobody having an allergy. `GET /v1/venues/{venueId}/config` therefore reads `dietaryValuesHidden`, read-only, and a `PUT` ignores it as it ignores `dietaryEnabled`.

    - It is `true` only with the switch off and a stored value on a `booked` or `seated` reservation of that venue, dated yesterday or later in the venue's time zone. Those are the guests the floor can still serve. Yesterday counts because a service can run past midnight. Counting finished or old reservations would keep the warning on until retention, long after it could change anything.
    - It is a boolean. Staff act the same for one value or ten: they ask the guests, or ask the operator. A count would tell every key that reads the config more, and a count that drops when one booking is seated or cancelled would say that this booking held health data.
    - `false` does not mean that nobody has an allergy (decision 4).

    **Withdrawal with the switch off.** A modify whose only field is `dietary: null` clears the value of a known reservation, on every status. A guest's withdrawal starts from the guest's own booking, so it works. Nothing lists the bookings that hold a value: no read carries it, the events and the trace do not name the field, and a `null` modify tells only by whether the version went up, after the value is gone. To find them, an operator turns the switch on again, which also lets new values be written, or queries the database (`SELECT id, date, status FROM reservations WHERE venue_id = '...' AND dietary IS NOT NULL`). A route that lists them, a flag on each reservation, and a venue-wide clear are not built. Each needs the owner's decision.
12. **`commentary` stays free of health data.** The contract keeps "not for health data" on `commentary` and points to `dietary`.
13. **Contract first.** The contract (`openapi.yaml`, `mcp.md`, C82) lands before the code (CLAUDE.md).

## Questions for the legal reviewer

Each can be answered yes or no, or by choosing an option. The owner's decisions above do not answer them.

1. **Basis.** Is explicit consent (article 9(2)(a)) the basis, collected by the person who takes the booking, or is another basis available to the restaurant? Who is the controller, the restaurant or the product operator? Is the attestation of decision 7 enough evidence of that consent?
2. **Visibility.** May every staff role and every key that reads the venue see the value? Is a separate kitchen role required before real use? The proposed wording says "sala y cocina".
3. **Retention.** Is "as long as the reservation's guest data, then cleared" enough, or must the value go sooner, for example after the service day?
4. **Encryption.** Is field-level encryption required, or are the database and disk protections enough?
5. **Read logging.** Must the system record who read the value?
6. **Public channel.** May the booking widget collect it, and with what consent wording?
7. **Hosting.** Does an operator who hosts an instance for restaurants become a processor of health data, and what agreement does it need?
8. **Closed lists.** Are the closed lists plus a short note acceptable, or must the free text be refused?
9. **AI provider.** Through MCP the value reaches the AI provider behind the MCP client. Must the consent wording name that, or must MCP stop carrying the field?
10. **Diet codes and religion.** `halal` and `kosher` can reveal religious belief, a special category of its own. The proposed wording names only health data ("este dato de salud"). What must the wording say, and may these codes stay?
11. **Withdrawal.** Is "write «borrad mi alergia» to the assistant, which then clears it" an adequate way to withdraw, given that the engine has no guest-facing withdrawal?

## Later steps

Each step is one pull request. The steps up to the demo can land before the review. No instance turns the switch on for real guests before the review answers.

1. This record and the contract. Done.
2. API: the `DIETARY` switch and its startup check, the `.env.example` entry, the migration and columns, validation, the read rules of decision 7, `dietaryEnabled` in the config, clearing in retention and erasure, the startup count, and tests for C82. Then C82 leaves GAP and `CHANGELOG.md` gets its entry. Done: the value is one jsonb column, `reservations.dietary`, and C82 is partial until step 3.
3. MCP: the field on `reservation.create`, `reservation.walk_in` and `reservation.modify`, returned where the API returns it, and a new npm release.
4. Staff app: allergen and diet buttons and the note on the create, walk-in and edit dialogs, the attestation checkbox, the value in the agenda, the pre-shift view and the floor card, nothing shown when absent, and a clear button for a withdrawal. Done. The floor plan also marks the occupied table, from the agenda, so staff know which card to open, and the table assignment dialog shows the value. The warning that reads `dietaryValuesHidden` is not built.
5. Hosted demo: `DIETARY: "on"` in `compose.demo.yaml`, invented values in the demo template (`apps/api/src/demo/template.ts`, ADR-0022), the notice next to the field in the demo ("invented data only, never a real allergy"), and the demo terms and site privacy wording in `apps/site` that say so.
6. After the legal review: the consent wording, the diet list, any kitchen role, and the switch for real guests.

## Consequences

**Easier.** The kitchen gets one place for the information, with no new standing data about people. An integrator can tell from one flag whether to ask the guest.

**Harder.** The engine takes on health data, and with `halal` and `kosher` possibly religious data. Erasure, retention, the demo template and the hosted demo's terms must cover the field. Every deployment needs its own answer to "who can read this". A reservation answer now differs by route: get and the agenda carry the field, list and search do not.

**Accepted.** Until step 2 ships, the routes ignore `dietary` and store nothing, so the contract tells integrators to read `dietaryEnabled` first. With the switch off, stored values stay in the database, hidden. Through MCP the value can reach an AI provider. Every staff role sees the value, because there is no kitchen role. `dietaryValuesHidden` tells every role and key that reads the config, integrators' keys included, that some current or upcoming booking of the venue holds health data. Where only one does, watching the flag while bookings are seated or cancelled shows which. With the switch off, each config read runs one more query, on the index by venue and date.

## Alternatives considered

- **A health profile on the guest record.** Rejected for a first version. It accumulates data across visits, makes erasure and retention harder, and is the form ADR-0003 postponed.
- **Free text only.** Rejected. It is unstructured, cannot be validated, and silently becomes health data with no governance. It is what the contract forbids in `commentary`.
- **A neutral reference in `commentary`, with the health data kept in the integrator's own system.** Valid, and the fallback while the switch is off. It keeps the engine out of health data, at the cost of the kitchen looking in a second place.
- **Do not build it.** Rejected by the owner on 2026-11-26 as a safety matter. The legal review can still stop real use.
- **A new error code for the switch off.** Rejected. It would need the API error registry and the staff app's message catalog to change in this step. `invalid_request` plus the `dietaryEnabled` flag tells the integrator the same, and the flag works before the guest is asked.
- **A count of hidden values instead of `dietaryValuesHidden`.** Rejected (decision 11).
- **Count every stored value, whatever its date and status.** Rejected (decision 11). The startup log already gives the operator that number.
- **Delete stored values when the switch is turned off.** Rejected. A deploy that loses the variable would wipe the allergies of the next service with no warning.
- **Refuse repeated codes.** Rejected. A repeated code has one meaning, and refusing it would push a guest's allergy out of the reservation over a formatting slip.
- **Keep MCP out of the field.** The first proposal, reversed by the owner on 2026-11-26 (decision 5). It kept the value from AI providers, at the cost of an agenda read through MCP not mentioning an allergy.
- **Allergens only, no diet codes.** The first proposal, reversed by the owner on 2026-11-26 (decision 6). It avoided religious data, at the cost of staff writing diets in the note.
