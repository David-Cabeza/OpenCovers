# ADR-0029: Contract rules for writes

- Status: Accepted (rule (a) built for staff reservation and waitlist writes; rules (b), (c) and (d) not built)
- Date: 2026-11-26
- Deciders: David Cabeza (owner)

ADR-0028 is reserved for moving a reservation to another date or time, which is not built.

## Context

An integrator sent a new time to `modify`, got `200` and believed the booking had moved. Nothing had changed. The route passed six fields to the engine and dropped the rest, and `openapi.yaml` listed `date`, `time` and `zone` as fields of a modify.

Other writes had the same shape. Unknown fields were ignored. A party of zero or below was accepted. A malformed or missing body answered a plain-text `500`. A repeat of an idempotency key answers success whatever its body says. A client cannot ask what an instance supports.

The rule behind all four decisions: the engine never answers success to a write it did not fully understand or that is impossible.

## Decision

### (a) A body the write does not fully understand is refused. Built for staff reservation and waitlist writes (C94)

- Each write route declares its fields in one place, with the strict parser of `apps/api/src/lib/body.ts`.
- An unknown field, a wrong type, a number out of range, a body that is not a JSON object, malformed JSON or a missing body fails with `invalid_request` and writes nothing. Never `500`.
- The code stays `invalid_request`. An authenticated route names the fields in `details.fields`. A public route refuses without `details`, so every public refusal looks alike.
- A route with no fields accepts an empty body and refuses any field.
- Strict on input, tolerant on output: a client ignores response fields it does not know.
- A successful answer matches every field sent. Until a modify can move a booking, `date`, `time` and `zone` are accepted only when they equal what a read returns, and a different value is refused by name. The comparison runs under the reservation's row lock.
- The engine refuses at once, with no warning window. The project is before 1.0, and `GOVERNANCE.md` allows it with a changelog entry and a migration note.

Not built: the same rule for `PUT /config` (a read-only field is accepted only when it equals the current value), `PUT /online-booking`, erasure, the public routes, the self-service link reissue, and unknown query parameters on authenticated reads.

### (b) The same idempotency key with another body is an error. Not built

- The engine stores a fingerprint with each key: the first 16 bytes of an HMAC-SHA-256 under an instance secret that is not in the database, over the kind of write, the target id and the parsed fields. It never stores the body or a plain hash of it.
- The content of `dietary` stays out of the fingerprint, only whether the field was sent ([ADR-0027](0027-allergies-and-dietary-needs.md)).
- The fingerprint expires after 48 hours and is cleared by erasure and retention. The key itself stays.
- Same key and same fingerprint is a repeat, `200` with `Idempotent-Replayed: true`. Another fingerprint fails with `idempotency_key_reused`, `409`, and writes nothing. A modify that changes nothing stores its key.
- It ships in two steps: first a warning header, one version later the refusal.
- The fingerprint waits for a legal review before it is built.

### (c) Every write answers with the complete resulting state. Not built

- A successful write returns the whole resource it wrote, read inside its own transaction, with the version that write produced.
- A `200` guarantees that the answer matches every field sent.
- A waitlist add also returns the new `entry`, next to `entries`.
- Erasure, the link resend and the link reissue keep their own answers.

### (d) The venue's configuration declares what it supports. Not built

- `GET /v1/venues/{venueId}/config` reads `contractVersion` and a short `capabilities` object, read-only, each tied to a conformance case. `dietaryEnabled` keeps its name.
- Each value says what the instance supports and the venue has turned on. What a role may do stays `forbidden`.
- A capability exists only where a client must know before it asks, or where the failure would be silent.

## Consequences

- A client that sent extra fields now gets `400` and has to stop sending them. `CHANGELOG.md` lists each case.
- A new field of a write needs one line in its field list. An engine older than a field now refuses it instead of dropping it, which a client can only know in advance once rule (d) is built.
- Until rule (b) is built, a repeat of a used key still answers `200` and applies nothing of its body, so a client that reuses a key for a new change is not told.
- A modify still does not check that a larger party fits the tables the booking holds. That comes with moving (ADR-0028), where a create and a modify share one placement function.
- Case numbers C83 to C93 are left for moving, and C95 to C97 for rules (b), (c) and (d).

## Alternatives considered

- A new error code for a rejected field: `invalid_request` already means a malformed request, and the detail fits in `details`.
- A warning window that answers `200` with a header naming the ignored fields: for `date` and `time` the `200` is the harm.
- Refusing `date`, `time` and `zone` outright: a client that sends the whole booking back, to change only the party size, would break although its answer would be true.
- A separate `move` operation instead of `modify` fields: the contract already published them, and ADR-0028 decides it.
