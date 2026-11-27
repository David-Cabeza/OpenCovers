# Roadmap

## Where the project stands

OpenCovers is pre-alpha. No restaurant runs on it yet.

What exists: the booking engine and its HTTP API, a staff app, a guest booking widget, an MCP server with 18 tools on npm, signed webhooks, a production Docker Compose stack, and a hosted demo with invented data. The database, not the application, refuses a double booking. 74 of the 93 conformance cases pass and 9 are partial. The other 10 specify moving a booking to another date or time (C83 to C92, [ADR-0028](docs/adr/0028-move-a-reservation.md)), which is not built yet. One of those is allergies and diets (C82): built in the API and the staff app behind a switch that is off by default, not yet in the MCP tools.

What is missing before a real venue can use it: a legal review of the texts a guest sees, automatic backups with a rehearsed restore, alerts, tests in a real browser, and someone to call when something breaks. The demo's terms and privacy notice were written without a lawyer's review.

This page is the plan. It does not list what is done.

- Works today, preview, not built: the [status table in the README](README.md#status).
- Every rule and its test: [conformance status](docs/contract/conformance-status.md).
- What changed and when: [CHANGELOG.md](CHANGELOG.md).
- Which guest emails exist and which do not: [guest emails](docs/guest-emails.md).

## What 2027 is for

**That a restaurant runs a full service on software it can read, host and leave, and that anyone can check it works.**

Three numbers measure the year. All three are zero today.

| Measure | Today | Goal for 15 Dec 2027 | We call it a miss below |
| --- | --- | --- | --- |
| Venues in service | 0 | 10, at least 3 run by someone other than the maintainer | 3 |
| Third parties that pass the conformance kit on their own deployment | 0 | 3 | 1 |
| Outside people credited in [CONTRIBUTORS.md](CONTRIBUTORS.md) | 0 | 25, of them 12 with a merged pull request | 10 |

A venue is "in service" when a real restaurant has taken all its bookings on OpenCovers for four weeks in a row, under a signed agreement, on an instance whose restore has been rehearsed. The demo does not count.

One maintainer runs the project, and AI agents write most of the code under review. Code is rarely what holds an item back. A lawyer, a venue, a server and people from outside are, so every item below says which.

### Three milestones with a name

- **The Double-Booking Trial** (goal: 1 March to 30 April). For two months anyone may try to book the same table twice on a public instance with invented data. We publish the rules, the method and the result. If someone breaks it, we publish that too, with credit, and fix it.
- **First Service** (goal: June; depends on the legal review and on a venue). The first night a restaurant works on OpenCovers alone, with no parallel book.
- **Without the Author** (goal: third quarter; depends on a third party). A venue runs for a month on an instance that someone other than the maintainer installed, upgraded and restored.

### Commitments

Dates are goals. A commitment that depends on someone outside the code says so, and its date moves in public the day that condition fails. A missed commitment stays on this board with its cause. It may get one new date. If it misses twice, it is cut or withdrawn here, in the open. "Met" needs a link to a pull request, a tag, a report or a command's output.

States: not started, in progress, waiting on someone, at risk, met, missed, cut.

| # | By | Commitment | Depends on | State | Evidence |
| --- | --- | --- | --- | --- | --- |
| C1 | 31 Mar | **The base holds real data.** A restore rehearsed every week, a nightly storm of 10,000 random writes with no overlap, three browsers in CI, releases that roll back, a non-root image, a stable instance deployed by tag | agents; owner (a server) | not started | |
| C2 | 15 Jan, then 31 Mar | **The legal review stops being an open question.** By 15 January it is commissioned, or this page says it will not be and what stays off. By 31 March the reviewed texts are applied | owner; legal | not started | |
| C3 | 1 Mar to 30 Apr | **The Double-Booking Trial**, with results and a load measurement published by 15 May | C1; owner (rules) | not started | |
| C4 | 31 Mar, then 30 Jun | **Remote MCP, complete** (#370, #371, #67), with venue isolation tested over `/mcp`. By 30 June a client we do not own completes a booking | agents; a third party | in progress | part 1 is merged, off by default |
| C5 | 30 Jun | **First Service.** One restaurant, four weeks alone after two in parallel, no double booking, and a public incident report | legal; a venue | waiting on someone | |
| C6 | 30 Jun, then 30 Sep | **Contract 1.0 and the conformance kit.** A versioned contract with a changelog and a written policy on breaking changes, and one command that runs the cases against any URL. By 30 September a third party passes it without help | agents; legal; a third party | not started | |
| C7 | 30 Jun and 15 Dec | **Outside people.** 10 credited by 30 June, 25 by 15 December, and a second regular reviewer. All year: a first answer from a person within 48 hours, measured and published | contributors; owner | not started | |
| C8 | 30 Sep | **Three venues, and Without the Author.** Also a written decision on a managed cloud, with the real costs of the pilots | venues; a third party; legal | not started | |
| C9 | 30 Sep | **An outside security review** with a public report. Paid if there is budget, an open peer review if not. We will say which | a third party; owner | not started | |
| C10 | 15 Dec | **Ten venues, and beta** only if every beta criterion below is true at once | all of the above | not started | |

The board is updated on the first Monday of each month, and ten days after each quarter ends we account for every commitment, the missed ones first.

## Now

Until the end of 2026. Goal: take the decisions the year hangs on, and open the kitchen to contributors.

- **The legal review package.** Done when a reviewer has one package with closed questions and three fixed-price quotes are requested. Blocked on: owner.
- **A server for the stable instance.** Done when a host apart from the demo is ready to run tagged releases. Blocked on: owner.
- **Timeouts and errors that fail safely.** Done when a stuck transaction cannot hold a venue's writes without limit, and an unexpected error answers in the contract's error format. Blocked on: nothing.
- **Remote MCP, part 2: grants and the consent screen** (#370). Blocked on: nothing.
- **Tasks reserved for people.** Done when the [`brigada` label](https://github.com/David-Cabeza/OpenCovers/labels/brigada) marks tasks the project's own agents do not take, and [CONTRIBUTING.md](CONTRIBUTING.md) opens with a ten-minute route. Blocked on: owner.
- **ADR-0021 and ADR-0022 accepted or amended.** Both are still proposals. Blocked on: owner.

## Next

### First quarter of 2027: prove it

- **The Saturday Gate, technical part** (C1). See [the gate](#the-saturday-gate). Blocked on: owner, for a server.
- **Remote MCP, part 3** (#371, #67). Blocked on: nothing.
- **Reviewed texts applied** (C2): the link in the confirmation email and the consent question (ADR-0017 stages 8 and 11), so that C43, C44, C50, C51, C55 and C70 pass. Blocked on: legal.
- **A trust page.** The guest data model, retention, erasure, processors, known gaps and the legal status of each text, each with a link to its test or its date. Blocked on: nothing.
- **Move a booking to another date.** Done when staff and integrators change a booking's date and time without cancelling it, and C83 to C92 pass. The contract is written ([ADR-0028](docs/adr/0028-move-a-reservation.md)). Blocked on: nothing.
- **A guest screen in the staff app** (#374). Blocked on: nothing.
- **A printable service sheet and a pre-shift check.** Blocked on: nothing.
- **The project name.** It is provisional until 31 January. Blocked on: owner.

### Second quarter of 2027: use it for real

- **The pilot agreement, the rehearsal, and First Service** (C5). Blocked on: legal, a venue.
- **A CSV importer**, built from the pilot's real file. Blocked on: a venue.
- **Contract 1.0 and the conformance kit** (C6). Blocked on: nothing for the kit; legal for the last partial cases.
- **An availability target for the stable instance:** 99.5% a month, measured from outside, with a public status page. Blocked on: nothing.
- **Reminder and reconfirmation, built and off** (#375), with consent checks and STOP handling. Blocked on: legal, to turn it on.
- **Reports, first version:** covers, no-shows, cancellations, source and lead time, with CSV export. Blocked on: nothing.
- **The public waitlist, ready to turn on.** It is built and off by default; the table-ready notice is #376. Blocked on: legal.
- **A decision record on payments.** Blocked on: owner, legal.
- **An install and a restore done by someone else,** with their reports. Blocked on: a third party.

From 1 July 2027 we start no new feature unless an identified venue or integrator asked for it. Reliability, security, tests, the contract and documentation are exempt.

## Later

### Third quarter of 2027: it should not depend on us

- **The pilot report,** and the first time we speak to restaurants. Blocked on: C5.
- **Venues two and three, and Without the Author** (C8). Blocked on: venues, a third party.
- **A third party passes the conformance kit without help.** Blocked on: a third party.
- **The outside security review** (C9). Blocked on: a third party.
- **The managed cloud decision,** published on 30 September whatever it says. Blocked on: owner.
- **Native review of the five machine-assisted widget catalogs** (ca, fr, de, it, pt) and an English email catalog. Blocked on: native reviewers, legal.
- **Continuous archiving of the database.** Blocked on: nothing.
- **A deposit taken with the venue's own payment account,** only if a venue in service asks for it. Blocked on: owner, legal, a venue.

### Fourth quarter of 2027: ten tables set

- **Venues four to ten** (C10). Blocked on: venues, and on support time staying inside the maintainer's published limit.
- **Two API processes,** with a rolling deploy that drops no write. Blocked on: nothing.
- **Beta.** Tagged only when all of this is true at once: three or more venues in service, one of them run without the author; no partial conformance case; a rehearsed restore on every instance; contract 1.0 and the kit published; no double booking on record; the outside review done; the managed cloud decision written; the availability target met in the last quarter. Blocked on: all of it.
- **An open annual report and the 2028 roadmap,** written from the pilots' reports.

## The Saturday Gate

No real guest data enters any instance until all of this is true at once. It is a gate, not a date.

- **Technical.** An encrypted off-site backup and a weekly automated restore; adversarial race tests for the no-overlap rule and the overbooking ceiling; Chromium, WebKit and Firefox in CI; tagged, non-root images with a migration step of its own and a graceful shutdown; lock and statement timeouts; a readiness check that reaches the database; logs with no personal data, and an alert; a rate limit on writes made with a key; the [checklist before the first real venue](docs/hardening.md).
- **Operational.** A pilot instance apart from the demo; no deploys from Thursday to Sunday; a printed service sheet before each shift; an outage drill run once with the staff; written support hours.
- **Legal.** The review delivered and applied; a signed agreement that says who the controller and the processor are; the venue's privacy notice linked from the widget; a breach procedure, rehearsed.
- **Product.** A booking can move to another date, and a venue can export everything it holds.

Everything guest-facing is built off and turned on only with the review that covers it.

## Blocked on someone outside the code

- **A legal review.** It unblocks six of the eight partial conformance cases, the public waitlist, reminders and any pilot. The briefs are written: [demo](docs/legal-review-demo.md), [waitlist](docs/legal-review-waitlist.md).
- **A first venue.** Independent, one room, a paper book or a spreadsheet today, willing to keep two books for two weeks. The [founding-venues page](https://opencovers.dev/hoja-de-ruta/#locales-fundadores) explains how.
- **Native reviewers** for Catalan, French, German, Italian and Portuguese.
- **Someone to install it and restore it without us,** and to tell us where the guides fail.
- **Clients and integrators** that call the stable instance, and later run the conformance kit.
- **A security reviewer.**
- **Payment and messaging accounts.** They belong to the venue, never to the project.

## Not planned

For 2027:

- **Feature parity with mature platforms.** They have years of craft in deposits, guest marketing, point-of-sale integrations and support at scale. We match only what a floor uses in every service.
- **Launching or announcing a managed cloud.** [ADR-0020](docs/adr/0020-monetization-and-premium-floor-plan.md) names it as the first paid offer and does not schedule it. In 2027 there is a free instance for up to ten founding venues and a written decision in September. What a venue needs to run a service stays free and open.
- **"Payments available."** 2027 brings a decision record and, at most, one deposit with one willing venue.
- **Guest marketing:** segments, campaigns, win-back, birthdays, surveys that route to reviews, gift cards. It conflicts with the rule of storing the minimum.
- **Allergies and diet with real guests.** The owner decided on 2026-11-26 to build the field as a safety matter, behind a switch that is off by default ([ADR-0027](docs/adr/0027-allergies-and-dietary-needs.md)). It is health data, so use with real guests waits for a legal opinion of its own.
- **Shared guests across venues, private dining, ticketed events.**
- **Wallet passes, a theme registry, a PWA, plugins that run code, editable email templates.**
- **Our own AI:** voice, no-show prediction, notes. The MCP door lets someone else's agent in.
- **A language shown to real guests without a named native reviewer.**
- **Redis, queues, Kubernetes, a high-availability database, an availability guarantee in a contract.**

Not at all, because an open-source engine cannot or should not own them:

- A consumer marketplace or demand network.
- Enrichment of guest profiles from third-party consumer data.
- Pulling bookings out of other platforms with a venue's login. It breaks their terms of service.
- Hardware cashless systems and hosted telephony.
- Security certifications. They belong to whoever runs the service, not to the code.
- Managed onboarding. We offer importers, seed data and documentation instead.

## How to pick up work

- Start with the ten-minute route in [CONTRIBUTING.md](CONTRIBUTING.md). You do not need to read anything else first.
- Tasks reserved for people from outside carry the [`brigada` label](https://github.com/David-Cabeza/OpenCovers/labels/brigada). The project's own agents do not take them.
- There are tracks for backend and concurrency, front end and accessibility, native speakers, testing on your own phone, guides, people who have run a dining room, and AI agents with a person who answers for them. Half of them need no code.
- Comment on a task to claim it. A person answers within 48 hours.
- If you run a restaurant, the [founding-venues page](https://opencovers.dev/hoja-de-ruta/#locales-fundadores) says how to join. If you practise data protection law, write to the maintainer before anything else.
- Credit goes in [CONTRIBUTORS.md](CONTRIBUTORS.md), with the name you choose, and only if you say yes.

Older decision records refer to numbered phases. That list ended on 2026-11-23 and stays in this file's history.
