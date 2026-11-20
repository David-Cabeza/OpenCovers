# Legal review brief: hosted demo privacy notice and consent (ADR-0022)

Status: draft for a lawyer's review. Nothing here is legal advice or approved text. The notice under review is [`apps/site/public/privacidad.html`](../apps/site/public/privacidad.html) (pull request #262, not merged). Its yellow brackets mark what the reviewer decides. The demo runs at `demo.opencovers.dev` and is not public: the site button that points to it (pull request #260) stays unmerged until this review is done.

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
| Newsletter lead (only if the optional box is ticked): email as typed and normalized, sign-in method, language, sign-up date, last visit, consent text version (v1) | News about OpenCovers | Up to 12 months after the last visit, and it survives the sandbox |
| Abuse limits: counters per IP (IPv6 per /48) and per normalized email | Stop automated sign-ups | In server memory only, lost on restart, longest window one day |

Server logs: the API logs start-up lines and errors, not requests, IPs or emails. An unexpected error may carry a technical detail that contains an email. The web server writes no access log. Docker keeps up to three files of 10 MB per container. The demo database has no backups.

Emails the demo sends: the sign-in link, and booking notices of the sandbox restaurant. Both go only to the visitor's verified address. A guest who types another address in the sandbox widget gets nothing. No email goes to anyone else.

Cookies and local storage: one session cookie (`__Secure-better-auth.session_token`, 7 days), one short sign-in cookie for Google (5 minutes), and local storage entries for interface state and the checkbox choice. No analytics or advertising cookies.

## Processors and places

Hetzner Cloud (server and database, Helsinki). Resend (email sending; the owner reports the domain is in the EU region, Ireland). Google (sign in, if chosen; fonts for the app). Cloudflare (DNS and the privacy mailbox forwarding; demo traffic does not pass through it). GitHub (hosts the website and the code; receives no demo data). We have not checked any processor's transfer safeguards or signed any data processing agreement beyond each provider's standard terms.

## Proposed consent text (v1)

Shown unticked on the sign-in form, optional, next to a link to the notice:

> Acepto recibir novedades sobre OpenCovers.
> Opcional. La demo funciona igual en ambos casos. · Aviso de privacidad

The API accepts only the current version string and stores it with the lead. Withdrawal today is by email to the privacy mailbox, and the operator deletes the row by hand. There is no unsubscribe link. The tool that would send the news is not chosen, and no news has been sent.

## Proposed legal bases (to validate)

| Purpose | Proposal |
| --- | --- |
| Account, session and sandbox | Pre-contractual measures at the visitor's request |
| News about OpenCovers | Consent (the box above) |
| Abuse prevention (limits, session record) | Legitimate interest |

## Questions for the reviewer

1. Are the three proposed bases right, and does each purpose need an interest assessment or other record?
2. Is the consent text enough (purpose, controller, optional, no effect on the demo), or must the label name the controller, the retention or the right to withdraw?
3. Is withdrawal by email acceptable at launch, or must the unsubscribe link exist before the first message? Does anything need to ship before the box goes live?
4. Which safeguards are required for the transfers outside the EEA (Google, Cloudflare, GitHub, and Resend if its region is not Ireland)? Is the providers' standard terms enough or is more needed?
5. A visitor can share the sandbox widget link. Another person then types their data, and the visitor sees it. Who is responsible for that data, and does the notice cover it, or must the widget show its own notice?
6. Is a 12-month retention of the lead from the last visit proportionate, and may it outlive the account it came from?
7. Does the notice meet the information duties (RGPD art. 13, LSSI), including the identity and address shown? Is the Spanish Data Protection Agency the right authority to name?
8. Is the notice, written in Spanish only, enough for visitors who use the English or other interface languages?
9. Are the session record (IP and user agent) and the rare error log that may contain an email a risk that needs a stated retention or a change?

## What changes after the review

The reviewer's text replaces the three marked bases and the transfers paragraph in the notice, and the consent label in `apps/web/src/i18n/catalog/demo.ts` if it changes (bumping the version in `apps/api/src/demo/settings.ts` and in the notice). Then pull request #262 merges, the Google sign-in app is published, and last the site button (#260). The same review should cover the waitlist wording in [`legal-review-waitlist.md`](legal-review-waitlist.md).
