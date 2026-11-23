# Legal review brief: hosted demo privacy notice and terms (ADR-0022)

Status: the demo opened to the public on 2026-11-21 by the owner's decision, before any legal review. The privacy notice ([`apps/site/public/privacidad.html`](../apps/site/public/privacidad.html), pull request #262) and the site button (#260) are merged, and the Google sign-in app is published. The terms of use ([`apps/site/public/condiciones.html`](../apps/site/public/condiciones.html)) and the notice were drafted without a lawyer, and nobody has reviewed them. The review is pending and optional. Nothing here is legal advice or approved text. The notice's open points for a reviewer are listed in a comment at the top of the file. The sign-in form says "By continuing you accept the terms of use and the privacy policy" and links both. The demo collects no newsletter leads and has no consent box (ADR-0022, amendment of 2026-11-21). The demo runs at `demo.opencovers.dev`.

## Who and what

The controller is David Cabeza, a sole trader in Madrid (identity and address are in the notice). The privacy mailbox is `privacidad@opencovers.dev`, forwarded to the controller's inbox.

The demo gives each visitor a sandbox restaurant of their own, filled with invented data, so a restaurateur can try the staff app and the guest booking widget. The visitor signs in with an email link or with Google. The sandbox and the account are deleted after 14 days without a visit. The marketing website `opencovers.dev` stores nothing about visitors and is out of scope except for the notice that covers it.

## Data processed

| Data | Why | Kept |
| --- | --- | --- |
| Email address, normalized email (lowercase, Gmail dots and `+tag` removed) | Account, one sandbox per person | Until deletion, 14 days after the last visit |
| With Google: name, photo URL, verified-email flag, provider ids and tokens (scopes `openid email profile`) | Sign in | Same |
| Pending magic link: address and a hash of the link, never the link | Sign in; the link expires in 5 minutes and works once | Until it expires |
| Session: date, IP address, user agent | Session security; 7 days, renewed on use | Until the session or the account is deleted |
| Whatever the visitor adds to the sandbox: bookings, guests, notes, blocks, API keys; and what anyone types into its guest widget (name, email or phone, comment, the venue-communications box) | The product working | Until deletion, 14 days after the last visit |
| Blocklist entries: a keyed hash of the email or phone, not the value | Venue blocklist feature | With the sandbox |
| Abuse limits: counters per IP (IPv6 per /48) and per normalized email | Stop automated sign-ups | In server memory only, lost on restart, longest window one day |

Server logs: the API logs start-up lines and errors, not requests, IPs or emails. An unexpected error may carry a technical detail that contains an email. The web server writes no access log. Docker keeps up to three files of 10 MB per container. The demo database has no backups.

Emails the demo sends: the sign-in link, and booking notices of the sandbox restaurant. Both go only to the visitor's verified address. A guest who types another address in the sandbox widget gets nothing. No email goes to anyone else.

Cookies and local storage: one session cookie (`__Secure-better-auth.session_token`, 7 days), one short sign-in cookie for Google (5 minutes), and local storage entries for interface state. No analytics or advertising cookies.

## Processors and places

Hetzner Cloud (server and database, Helsinki). Resend (email sending; the domain sends from the EU region, Ireland, but Resend keeps its account data in the US). Google (sign in, if chosen; fonts for the app). Cloudflare (DNS and the privacy mailbox forwarding; demo traffic does not pass through it). GitHub (hosts the website and the code; receives no demo data).

Transfers outside the EEA were checked on 2026-11-22 from each provider's official pages. Resend, Google, Cloudflare and GitHub process data in the US. Each states it is certified under the EU-US Data Privacy Framework (DPF) and falls back to the Commission's standard contractual clauses (SCCs) if the framework lapses. Resend's data processing agreement is part of its terms, and so is Cloudflare's and GitHub's. Hetzner keeps the data in the EU (Finland) and makes no such transfer. Hetzner's data processing agreement is concluded by the customer in the account, and the owner reports concluding it on 2026-11-22. No other agreement was signed beyond each provider's standard terms. The notice says the same in its transfers paragraph.

## Proposed legal bases (to validate)

| Purpose | Proposal |
| --- | --- |
| Account, session and sandbox | Pre-contractual measures at the visitor's request |
| Abuse prevention (limits, session record) | Legitimate interest |

## Questions for the reviewer

1. Are the two proposed bases right, and does each purpose need an interest assessment or other record?
2. Are the safeguards enough for the transfers outside the EEA (Resend, Google, Cloudflare, GitHub): DPF certification with the SCCs as fallback, and each provider's standard data processing terms? Is more needed, for example a transfer impact assessment, given that Resend keeps its account data in the US although mail leaves from Ireland?
3. A visitor can share the sandbox widget link. Another person then types their data, and the visitor sees it. Who is responsible for that data, and does the notice cover it, or must the widget show its own notice?
4. Does the notice meet the information duties (RGPD art. 13, LSSI), including the identity and address shown? Is the Spanish Data Protection Agency the right authority to name? Are the terms of use sound, and is accepting them by continuing enough?
5. Are the notice and the terms, written in Spanish only, enough for visitors who use the English or other interface languages?
6. Are the session record (IP and user agent) and the rare error log that may contain an email a risk that needs a stated retention or a change?

## What changes after the review

If a review happens, the reviewer's text replaces the bases and the transfers paragraph in the notice, and any change to the terms goes into `condiciones.html`. The same review should cover the waitlist wording in [`legal-review-waitlist.md`](legal-review-waitlist.md).
