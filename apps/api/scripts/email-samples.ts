// Writes one sample file per email (HTML, plain text and the calendar file) to a folder, so the layout can be opened
// in a browser. The venue is a made-up one with an address and a phone, and "bare" has neither, to see both shapes.
// Run: pnpm --filter @opencovers/api exec tsx scripts/email-samples.ts [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { magicLinkEmail } from "../src/lib/auth";
import { emailVenue } from "../src/lib/email-venue";
import { buildEmail, buildLinkEmail } from "../src/lib/mailer";

const out = resolve(process.argv[2] ?? "email-samples");
mkdirSync(out, { recursive: true });

const venue = emailVenue({
  name: "Casa Paco",
  publicStreet: "Calle Mayor 12",
  publicLocality: "Madrid",
  publicPostalCode: "28013",
  publicPhone: "+34 910 000 000",
});
const bare = emailVenue({ name: "Casa Paco", publicStreet: null, publicLocality: null, publicPostalCode: null, publicPhone: null });
const booking = (version: number) => ({
  uid: "0123456789abcdef0123456789abcdef@opencovers.dev",
  version,
  startsAt: new Date("2026-12-01T19:30:00Z"),
  endsAt: new Date("2026-12-01T21:30:00Z"),
});
const ctx = { date: "2026-12-01", time: "20:30", partySize: 4, service: "Cena", venue, booking: booking(1), now: new Date("2026-11-20T10:00:00Z") };
const link = (token: string) => `https://reservas.example.com/r?lang=es#${token}`;

const mails = {
  confirmation: buildEmail("confirmation", ctx, "es"),
  "confirmation-bare": buildEmail("confirmation", { ...ctx, venue: bare, service: "" }, "es"),
  modification: buildEmail("confirmation", { ...ctx, booking: booking(2) }, "es"),
  cancellation: buildEmail("cancellation", { ...ctx, booking: booking(3) }, "es"),
  notice: buildEmail("notice", ctx, "es"),
  "self-service-link": buildLinkEmail(
    [
      { date: "2026-12-01", time: "20:30", partySize: 4, url: link("tokenA") },
      { date: "2026-12-05", time: "21:00", partySize: 2, url: link("tokenB") },
    ],
    "es",
    venue,
  ),
  "magic-link-es": magicLinkEmail("es", "https://demo.opencovers.dev/api/auth/magic-link/verify?token=abc123&callbackURL=%2F"),
  "magic-link-en": magicLinkEmail("en", "https://demo.opencovers.dev/api/auth/magic-link/verify?token=abc123&callbackURL=%2F"),
};

for (const [name, mail] of Object.entries(mails)) {
  writeFileSync(join(out, `${name}.html`), mail.html);
  writeFileSync(join(out, `${name}.txt`), `Subject: ${mail.subject}\n\n${mail.text}`);
  const ics = "attachments" in mail ? mail.attachments[0] : undefined;
  if (ics) writeFileSync(join(out, `${name}.ics`), Buffer.from(ics.content, "base64"));
}
console.log(`wrote ${Object.keys(mails).length} emails to ${out}`);
