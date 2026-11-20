// Writes one sample HTML file per email to a folder, so the layout can be opened in a browser.
// Run: pnpm --filter @opencovers/api exec tsx scripts/email-samples.ts [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { magicLinkEmail } from "../src/lib/auth";
import { buildEmail, buildLinkEmail } from "../src/lib/mailer";

const out = resolve(process.argv[2] ?? "email-samples");
mkdirSync(out, { recursive: true });

const ctx = { date: "2026-12-01", time: "20:30", partySize: 4, guestName: "Ana", service: "dinner", venueName: "Casa Paco" };
const link = (token: string) => `https://reservas.example.com/r?lang=es#${token}`;

const samples: Record<string, string> = {
  "magic-link-es": magicLinkEmail("es", "https://demo.opencovers.dev/api/auth/magic-link/verify?token=abc123&callbackURL=%2F").html,
  "magic-link-en": magicLinkEmail("en", "https://demo.opencovers.dev/api/auth/magic-link/verify?token=abc123&callbackURL=%2F").html,
  confirmation: buildEmail("confirmation", ctx).html,
  cancellation: buildEmail("cancellation", ctx).html,
  notice: buildEmail("notice", ctx).html,
  "self-service-link": buildLinkEmail(
    [
      { date: "2026-12-01", time: "20:30", partySize: 4, url: link("tokenA") },
      { date: "2026-12-05", time: "21:00", partySize: 2, url: link("tokenB") },
    ],
    "Casa Paco",
  ).html,
};

for (const [name, html] of Object.entries(samples)) writeFileSync(join(out, `${name}.html`), html);
console.log(`wrote ${Object.keys(samples).length} files to ${out}`);
