# ADR-0020: Monetization and the premium floor plan

- Status: Accepted
- Date: 2026-11-18
- Deciders: David Cabeza

## Context

OpenCovers is Apache-2.0 and pre-alpha. No document records how the project might earn money (checked `docs/cmo-brief.md`, the README and `docs/requirements.md`).

The staff app is getting a richer floor plan: new room elements (sofa, column, stairs, rug, large plant, umbrella) and a second look, "Ambiente", with floor textures, shadows and illustrated furniture, next to the current line "Plano" look. The question is whether any of that should be paid.

Constraints:

- Anything in this repository is under Apache-2.0. A paid feature that ships here can be forked or unlocked by deleting a check, and we cannot relicense what contributors have given us.
- Staff need the floor plan to run a service. Charging for what the floor needs to work would hurt the project's credibility with the self-hosting and developer audience the launch targets.
- The design rules do not change: availability, no-overlap and data isolation stay in the open core. See CLAUDE.md.
- Visual assets from third parties (stock vector sites, AI-generated images) carry licences that cannot be redistributed under Apache-2.0. Every asset we ship is drawn in this repository or comes from a CC0 or public-domain source recorded in `docs/`.

## Decision

Accepted on 2026-11-18:

1. **The engine and the functional staff app stay free.** Availability, bookings, tables, the floor plan with its basic room elements, the "Plano" look, the widget, the MCP server and the API are Apache-2.0 and have no paid gates.
2. **The first paid offer is a managed cloud**, not a feature lock. It charges for hosting, backups, updates, support and a widget on the venue's own domain. The code is the same as the self-hosted code.
3. **A premium visual pack is optional and comes later.** The "Ambiente" look and themed furniture packs could be sold as a separate proprietary package loaded by the cloud, and installable on self-hosted setups with a licence key. It is not started until step 2 exists. If it happens, the open core exposes a small extension point (a floor "skin" registry) and does not contain the paid assets.
4. **The look is chosen per user, stored in the browser.** It is not a venue setting and not part of the API contract, so it needs no migration and no change to `openapi.yaml`.
5. **Nothing paid is built into the open core now.** The "Ambiente" look stays unpublished until the skin registry exists. New room elements are free.

## Consequences

- The project keeps the trust of self-hosters, and the cloud is the revenue path that does not depend on a licence check in open code.
- Selling a premium pack means designing the skin registry as a separable module from the start, and keeping licensed assets out of the repository and its history.
- A self-hoster can build their own look, since the registry is open. That is accepted.
- The cloud needs billing, tenancy and operations work that this repository does not have yet. This ADR does not schedule it.
- Pricing, plans and the brand name are open: the name is provisional (`docs/cmo-brief.md` §12).

## Alternatives considered

- **Everything free, charge only for services and support.** Simplest and best for the community. Rejected as the only plan because it leaves the design work unfunded, but it is the fallback if the cloud never launches.
- **Paid features inside the repository (open core with licence checks).** Rejected: forkable and removable under Apache-2.0, and it invites a contributor fight over what counts as premium.
- **Relicense to a source-available licence (BSL or similar).** Rejected for now: it breaks the open-source claim the launch is built on, and it needs a contributor agreement we do not have.
- **Use stock vectors or AI-generated floor images as the premium look.** Rejected: licences forbid redistributing the files, and the images would not follow the venue's real layout.
