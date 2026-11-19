# ADR-0023: Channel and actor on every reservation event

- Status: Accepted
- Date: 2026-11-19
- Deciders: David Cabeza

## Context

A reservation's history cannot say whether a change came from the widget, the staff app, the HTTP API or the MCP server, nor who cancelled or modified it. A reader of the events table can only guess from `bookedVia`, which names the creator and never a later change, and which cannot tell the MCP server from any other API key.

## Decision

Each row of `events` carries two nullable columns written in the same transaction as the event.

- `channel`: one of `widget`, `staff`, `api`, `mcp`. A database check refuses any other value.
- `actor`: a stable, non-personal reference. A staff session writes the user id. An API key writes `key_` plus the first 12 hex characters of the key's stored hash, which tells keys apart but cannot authenticate. A guest writes null.

The server derives both from how the request authenticated. Public routes write `widget` and null, and read no header or body field. A session writes `staff`. An API key writes `api`, or `mcp` when the request carries `X-OpenCovers-Channel: mcp`. The MCP server sends that header on every call. A session ignores the header and a public route never reads it.

The `mcp` label is set by the key's holder, so it is a label and not proof. It cannot raise anyone's privileges, the actor still names the key, and no other channel can be claimed through it. A per-key marker would be proof, but it needs a column on `api_keys` and a step when a key is minted, which is more than this change needs. A keyed caller that wants to look like MCP can, and gains nothing.

Rows written before this change, and events written by a system sweep (retention erasure), stay null. A reader treats null as unknown.

## Consequences

- The events feed and the signed webhook payload do not change. The values are persisted for a later reader (the reservation trace in the staff app) and the contract is untouched. Exposing them is a contract change that needs its own conformance case.
- A staff user id is personal data of staff, not of a guest. Erasing a user leaves their id in events. A key id is a prefix of a hash, not the key.
- Migration `0040` may collide with another open pull request's. The one that merges second regenerates its migration with `pnpm db:generate`.

## Alternatives considered

- The key's `principal` label as actor. It is free text an admin writes and may be an email.
- A client-supplied channel in the body. Rejected: a public caller could set it.
- A per-key channel column. Proof, but a larger change to key minting.
