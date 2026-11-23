# Legal review brief: public waitlist wording (ADR-0021 Q11)

Status: draft for a lawyer's review. Nothing here is legal advice or approved text. The wording below is a proposal to be changed by the reviewer. The code ships the email text as provisional (`apps/api/src/lib/email-messages.ts`). The waitlist is off by default (`waitlistEnabled` is false), and the hosted demo keeps it off.

## What the feature does

A guest who finds a date fully booked can leave their name, an email address, party size, the date and an optional time window. The venue's staff see the entry and may call or write to the guest. The product makes no booking and no automatic offer.

| Item | Behaviour |
| --- | --- |
| Data collected | Name (1 to 100 characters), one email address, party size, date, optional time window, the time the consent box was ticked. No note, no phone, no marketing field. |
| Consent box | Required to join, shown unticked. It is the only consent in the flow. |
| Email sent | One email at join, to that address: venue name, date, window, party size, a link to leave the list. It carries no guest name. |
| Later emails | None in v1. The consent covers only emails about this entry. |
| Leaving | The guest leaves through the link in the email. The link works until the end of the entry's date. |
| Retention | Public entries are deleted the day after their date. Erasure by the venue deletes the entry, the link and the consent record. |
| Where it is stored | The venue's database. The email goes through the venue's own email provider if configured (Resend by default in the hosted setup). |
| Blocklist | A venue can block a contact; the join then fails with the same answer as a blocked booking. |

## Proposed text (Spanish first, to be translated only after approval)

**Consent box label** (shown unticked, next to the join button):
> Acepto que {venue} me escriba a este correo sobre esta solicitud de lista de espera (no recibiré publicidad).

**Notice link** next to the button, when the venue has set a privacy notice URL: "Aviso de privacidad".

**Email text** (current provisional wording in the code):
- Subject: "Estás en la lista de espera de {venue}: {día}"
- Lead: "Te hemos apuntado en la lista de espera de {venue}. Esto no es una reserva: el restaurante te escribirá o te llamará si queda una mesa libre."
- Leave hint and button: "Si ya no puedes venir, sal de la lista con este enlace." / "Salir de la lista de espera"
- Outro: "Solo te escribimos sobre esta solicitud. Si no la has hecho tú, puedes ignorar este mensaje."

## Questions for the reviewer

1. Is an unticked box, required to join and covering only emails about the entry, valid consent for this email, or is the email a service message that needs no consent? If no consent is needed, should the box stay as information?
2. Does the label say enough (purpose, who writes, no advertising), or must it name the controller, the retention or the right to withdraw?
3. Who is the controller for the waitlist data, the venue or the software provider, and what must the privacy notice say about it? The product itself writes no legal text.
4. Is a join acceptable when the venue has set no privacy notice URL, or must the widget refuse it?
5. The email can be sent to an address typed by someone else. Is the "if you did not make this request, ignore this message" line enough, and is a single confirmation email proportionate?
6. Is deletion the day after the date an acceptable retention, and is deleting the consent record together with the entry acceptable, given that the proof of consent disappears with it?
7. Each language (`es`, `en`, `ca`, `fr`, `de`, `it`, `pt`) needs its own review of this text before it ships (ADR-0024, Q5). Which jurisdictions' wording rules apply per language?

## What changes after the review

The reviewer's text replaces the label and the email catalog entries. The widget stage (ADR-0021 stage 12) already shipped (PR #293), off by default with this provisional wording, so until the review no venue should turn the waitlist on for real guests, and the demo keeps it off. The same review covers the confirmation email (REQ-N2) and the consent stored per booking (REQ-N4).
