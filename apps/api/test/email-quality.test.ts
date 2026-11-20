// The quality bar for every email the engine sends, enforced so nobody has to review each one by eye. It renders every
// kind in every shipped locale, with a full venue, a bare one, no venue and a hostile one, and checks the facts, the
// markup rules, the colors, the size and the calendar file. A new locale or a new kind lands in these loops on its own.
import { describe, expect, it } from "vitest";
import { magicLinkEmail } from "../src/lib/auth";
import { accentFor, BODY_PX, DARK, DEFAULT_ACCENT, LIGHT } from "../src/lib/email-layout";
import { EMAIL_CATALOGS, MAGIC_LINK_CATALOGS, formatEmailDay, message, partyLabel } from "../src/lib/email-messages";
import { emailVenue, type EmailVenue } from "../src/lib/email-venue";
import { buildEmail, buildLinkEmail, GUEST_MANAGE_LINK_ENABLED, MAX_SUBJECT_LENGTH, type BuiltEmail } from "../src/lib/mailer";
import { contrast } from "../src/lib/contrast";
import { icsUid } from "../src/lib/ics";
import { parseIcs } from "./ics-parse";

const MAX_HTML_BYTES = 90 * 1024; // Gmail clips a message at about 102 KB.
const EVIL = `Casa <img src=x onerror=alert(1)> "&' <script>alert(1)</script>`;

const full: EmailVenue = emailVenue(
  { name: "Casa Paco", publicStreet: "Calle Mayor 12", publicLocality: "Madrid", publicPostalCode: "28013", publicPhone: "+34 910 000 000" },
  { logoUrl: "https://cdn.example.com/logo.png", colors: { primary: "#7a1f3d", onPrimary: "#ffffff" } },
);
const bare: EmailVenue = emailVenue({ name: "Casa Paco", publicStreet: null, publicLocality: null, publicPostalCode: null, publicPhone: null });
const hostile: EmailVenue = emailVenue({
  name: EVIL,
  publicStreet: `Calle <b>1</b> "x"`,
  publicLocality: "Madrid & co",
  publicPostalCode: null,
  publicPhone: "+34 910 000 000",
});
const longName: EmailVenue = emailVenue({ name: "Restaurante Casa de Comidas El Rincón de la Abuela Paca y Familia", publicStreet: null, publicLocality: null, publicPostalCode: null, publicPhone: null });
const venues: [string, EmailVenue | undefined][] = [
  ["full", full],
  ["bare", bare],
  ["none", undefined],
  ["hostile", hostile],
  ["long name", longName],
];

const booking = (version: number) => ({
  uid: icsUid("v1", "r1"),
  version,
  startsAt: new Date("2026-12-01T19:30:00Z"),
  endsAt: new Date("2026-12-01T21:30:00Z"),
});
const HOSTILE_NAME = "Mallory <b>x</b> https://evil.example/x\nBcc: a@b.c\r\nSubject: hi";
const base = { date: "2026-12-01", time: "20:30", partySize: 4, service: "Cena", guestName: HOSTILE_NAME, now: new Date("2026-11-20T10:00:00Z") };

interface Case {
  name: string;
  locale: string;
  mail: BuiltEmail;
  /** The facts the text must carry. Empty for mail with no booking (the sign-in link). */
  facts: string[];
  /** Whether the mail is a booking mail with a calendar entry. */
  calendar: "PUBLISH" | "CANCEL" | null;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const locale of Object.keys(EMAIL_CATALOGS)) {
    const facts = [formatEmailDay(base.date, locale), base.time, String(base.partySize)];
    for (const [vname, venue] of venues) {
      const ctx = { ...base, venue };
      out.push({ name: `${locale} confirmation ${vname}`, locale, mail: buildEmail("confirmation", { ...ctx, booking: booking(1) }, locale), facts, calendar: "PUBLISH" });
      out.push({ name: `${locale} modification ${vname}`, locale, mail: buildEmail("confirmation", { ...ctx, booking: booking(2) }, locale), facts, calendar: "PUBLISH" });
      out.push({ name: `${locale} cancellation ${vname}`, locale, mail: buildEmail("cancellation", { ...ctx, booking: booking(3) }, locale), facts, calendar: "CANCEL" });
      out.push({ name: `${locale} notice ${vname}`, locale, mail: buildEmail("notice", { ...ctx, booking: booking(1) }, locale), facts, calendar: null });
      out.push({
        name: `${locale} self-service link ${vname}`,
        locale,
        mail: buildLinkEmail(
          [
            { date: base.date, time: base.time, partySize: base.partySize, url: "https://reservas.example.com/r?lang=es#tokenA" },
            { date: "2026-12-05", time: "21:00", partySize: 1, url: "https://reservas.example.com/r?lang=es#tokenB" },
          ],
          locale,
          venue,
        ),
        facts,
        calendar: null,
      });
    }
    // A booking with no calendar data still builds.
    out.push({ name: `${locale} confirmation without booking`, locale, mail: buildEmail("confirmation", { ...base, venue: full }, locale), facts, calendar: null });
  }
  for (const l of ["es", "en"]) {
    out.push({ name: `${l} magic link`, locale: l, mail: magicLinkEmail(l, "https://demo.opencovers.dev/api/auth/magic-link/verify?token=abc&callbackURL=%2F") as BuiltEmail, facts: [], calendar: null });
  }
  return out;
}

const all = cases();
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));

/** A small tag reader for the layout's own markup (no parser dependency): every start tag with its attributes. */
function startTags(html: string): { name: string; attrs: Record<string, string>; end: number }[] {
  const out: { name: string; attrs: Record<string, string>; end: number }[] = [];
  const blank = (m: string) => " ".repeat(m.length);
  const bare = html.replace(/<!--[\s\S]*?-->/g, blank).replace(/<style>[\s\S]*?<\/style>/, blank);
  for (const m of bare.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const attrs: Record<string, string> = {};
    for (const at of m[2]!.matchAll(/([a-z][a-z0-9:-]*)(?:="([^"]*)")?/gi)) attrs[at[1]!.toLowerCase()] = at[2] ?? "";
    out.push({ name: m[1]!.toLowerCase(), attrs, end: m.index! + m[0].length });
  }
  return out;
}
const cssProps = (style: string): Record<string, string> =>
  Object.fromEntries(style.split(";").filter(Boolean).map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]));
const hasClass = (t: { attrs: Record<string, string> }, cls: string) => (t.attrs.class ?? "").split(" ").includes(cls);
const styleBlock = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;

describe("email quality bar", () => {
  it("covers every kind in every shipped locale", () => {
    expect(all.length).toBeGreaterThan(20);
    for (const locale of Object.keys(EMAIL_CATALOGS)) expect(all.some((c) => c.locale === locale && c.name.includes("cancellation"))).toBe(true);
  });

  describe.each(all.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const { mail } = c;

    it("shows no raw ISO date anywhere", () => {
      const iso = /\b\d{4}-\d{2}-\d{2}\b/;
      expect(mail.subject).not.toMatch(iso);
      expect(mail.text).not.toMatch(iso);
      expect(mail.html.replace(/href="[^"]*"/g, "")).not.toMatch(iso);
    });

    it("has a bounded, specific subject", () => {
      expect(mail.subject.length).toBeGreaterThan(10);
      expect(mail.subject.length).toBeLessThanOrEqual(MAX_SUBJECT_LENGTH);
      expect(mail.subject).not.toMatch(/[—\n\r]/);
    });

    it("escapes every value: no markup from venue data survives", () => {
      expect(mail.html).not.toMatch(/<script/i);
      expect(mail.html).not.toContain("<img src=x");
      expect(mail.html).not.toContain("<b>1</b>");
      expect(mail.html).not.toMatch(/<[^>]*\sonerror=/i);
    });

    it("has only https links, or tel: for the phone, none empty", () => {
      const found = hrefs(mail.html);
      expect(found.length).toBeGreaterThan(0);
      for (const href of found) {
        expect(href, "empty href").not.toBe("");
        expect(href, href).toMatch(/^(https:\/\/\S+|tel:\+?\d{5,20})$/);
      }
      for (const m of mail.text.matchAll(/https?:\/\/\S+/g)) expect(m[0]).toMatch(/^https:/);
    });

    it("gives every image fixed size and an alt, so blocked images shift nothing", () => {
      for (const img of mail.html.matchAll(/<img\b[^>]*>/g)) {
        expect(img[0]).toMatch(/\salt="[^"]*"/);
        expect(img[0]).toMatch(/\swidth="\d+"/);
        expect(img[0]).toMatch(/\sheight="\d+"/);
      }
    });

    it("has a hidden preheader that is not the heading", () => {
      const pre = /<div style="display:none;[^"]*">([^<]*)<\/div>/.exec(mail.html)?.[1] ?? "";
      const visible = pre.replace(/&#8199;|&zwnj;/g, "").trim();
      expect(visible.length).toBeGreaterThan(15);
      expect(visible.length).toBeLessThanOrEqual(110);
      expect(visible).not.toBe(mail.subject);
    });

    it("hides the preheader and pads it so the inbox preview ends at its text", () => {
      const first = startTags(mail.html).find((t) => t.name === "div")!;
      expect(cssProps(first.attrs.style ?? "")).toMatchObject({
        display: "none",
        "max-height": "0",
        overflow: "hidden",
        "mso-hide": "all",
        opacity: "0",
        "font-size": "0",
        "line-height": "0",
      });
      const inner = mail.html.slice(first.end, mail.html.indexOf("</div>", first.end));
      const padding = /(?:&#8199;|&zwnj;|&nbsp;|&#847;)+$/.exec(inner)?.[0] ?? "";
      const count = (padding.match(/&[#a-z0-9]+;/g) ?? []).length;
      expect(count).toBeGreaterThanOrEqual(100);
      expect(count).toBeLessThanOrEqual(150);
    });

    it("keeps the preheader padding out of the plain-text part", () => {
      expect(mail.text).not.toMatch(/&#8199;|&zwnj;|&nbsp;|&#847;/);
      expect(mail.text).not.toMatch(/[​-‍  ͏﻿]/);
    });

    it("has a 620px phone breakpoint that fills the width, drops the radius and keeps buttons full width and tall", () => {
      const media = /@media only screen and \(max-width:\s*620px\)\{([\s\S]*?)\n\}/.exec(styleBlock(mail.html))?.[1] ?? "";
      expect(media).not.toBe("");
      const rule = (sel: string) => new RegExp(`(?:^|\\n)\\.${sel}\\{([^}]*)\\}`).exec(media)?.[1] ?? "";
      expect(rule("card")).toMatch(/width:100%!important/);
      expect(rule("card")).toMatch(/border-radius:0!important/);
      expect(rule("wrap")).toMatch(/padding:\d+px 0!important/);
      expect(rule("h1")).toMatch(/font-size:2[0-6]px!important/);
      expect(rule("btn-tbl")).toMatch(/width:100%!important/);
      expect(rule("btn-a")).toMatch(/min-height:(4[4-9]|[5-9]\d)px!important/);
      // The classes sit on the elements, and the inline base stays the 600px layout for clients that drop the block.
      const tags = startTags(mail.html);
      const card = tags.find((t) => hasClass(t, "card"))!;
      expect(card.attrs.width).toBe("600");
      expect(cssProps(card.attrs.style!)["max-width"]).toBe("600px");
      for (const cls of ["wrap", "h1", "bar"]) expect(tags.some((t) => hasClass(t, cls)), cls).toBe(true);
    });

    it("carries the client resets: Outlook table spacing, image defaults, text size adjust, DPI and a 600px ghost table", () => {
      const css = styleBlock(mail.html);
      expect(css).toMatch(/table,td\{[^}]*border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt/);
      expect(css).toMatch(/body\{[^}]*-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%/);
      expect(css).toMatch(/img\{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none;display:block\}/);
      expect(css).toMatch(/a\[x-apple-data-detectors\][^{]*\{[^}]*color:inherit!important/);
      expect(mail.html).toMatch(/<!--\[if mso\]>(?:(?!<!\[endif\]).)*<o:PixelsPerInch>96<\/o:PixelsPerInch>.*?<!\[endif\]-->/s);
      expect(mail.html).toMatch(/<!--\[if mso\]><table[^>]*width="600"[^>]*><tr><td width="600"><!\[endif\]-->/);
      expect(mail.html).toContain("<!--[if mso]></td></tr></table><![endif]-->");
      expect(mail.html).toContain('<meta name="x-apple-disable-message-reformatting">');
      expect(mail.html).toMatch(/<meta name="format-detection" content="[^"]*telephone=no/);
    });

    it("declares language, color schemes, a dark palette, a viewport and a title", () => {
      expect(mail.html).toMatch(/<html lang="[a-z]{2}"/);
      expect(mail.html).toContain('<meta name="color-scheme" content="light dark">');
      expect(mail.html).toContain("@media (prefers-color-scheme:dark)");
      expect(mail.html).toContain('name="viewport"');
      expect(mail.html).toMatch(/<title>[^<]+<\/title>/);
    });

    it("stays under the size budget", () => {
      expect(Buffer.byteLength(mail.html)).toBeLessThan(MAX_HTML_BYTES);
    });

    it("sets text at 16px or more for the body, 13px or more for everything but the preheader", () => {
      const visible = mail.html.replace(/<div style="display:none;[^"]*">[^<]*<\/div>/, "").replace(/<style>[\s\S]*?<\/style>/, "");
      const sizes = [...visible.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(13);
      expect(BODY_PX).toBeGreaterThanOrEqual(16);
      expect(visible).toContain(`font-size:${BODY_PX}px`);
    });

    it("makes every button at least 44px tall", () => {
      for (const a of mail.html.matchAll(/<a class="btn-a[^"]*"[^>]*>/g)) expect(a[0]).toMatch(/min-height:(4[4-9]|[5-9]\d)px/);
    });

    it("has a plain text part that says the same things", () => {
      expect(mail.text.trim().length).toBeGreaterThan(40);
      expect(mail.text.endsWith("\n")).toBe(true);
      for (const fact of c.facts) expect(mail.text, fact).toContain(fact);
      const venue = venues.find(([n]) => c.name.endsWith(n))?.[1];
      if (venue?.name && c.facts.length > 0) {
        // The text names the venue, and every link of the html is in the text, except the VML twin and the phone.
        expect(mail.text).toContain(venue.name);
      }
      for (const href of new Set(hrefs(mail.html))) {
        if (href.startsWith("tel:") || href === "https://opencovers.dev") continue;
        // A map link on the address row shows as the address in text. Only the "how to get there" button prints its URL.
        const printed = href.includes("google.com/maps") ? mail.html.includes(`>${message(c.locale, "map.open")}</a>`) : true;
        if (printed) expect(mail.text, href).toContain(href);
      }
      expect(mail.text).not.toMatch(/<(table|td|div|a|span|br|style)\b/i);
    });

    it("carries the facts in the html as well", () => {
      for (const fact of c.facts) expect(mail.html.replace(/&amp;/g, "&"), fact).toContain(fact);
    });

    if (c.calendar) {
      it("attaches a well-formed calendar file", () => {
        expect(mail.attachments).toHaveLength(1);
        const [file] = mail.attachments;
        expect(file!.filename).toMatch(/^[a-z-]+\.ics$/);
        const ics = parseIcs(Buffer.from(file!.content, "base64").toString("utf8"));
        expect(ics.calendar.find((p) => p.name === "METHOD")?.value).toBe(c.calendar);
        expect(ics.get("DTSTART")).toBe("20261201T193000Z");
        expect(ics.get("DTEND")).toBe("20261201T213000Z");
        expect(ics.get("UID")).toBe(icsUid("v1", "r1"));
        expect(ics.get("STATUS")).toBe(c.calendar === "CANCEL" ? "CANCELLED" : "CONFIRMED");
        expect(Number(ics.get("SEQUENCE"))).toBe(c.name.includes("cancellation") ? 3 : c.name.includes("modification") ? 2 : 1);
        // No venue text is trusted blindly into the file: it is escaped, never a new property.
        expect(ics.event.map((p) => p.name)).not.toContain("ATTENDEE");
        expect(ics.event.map((p) => p.name)).not.toContain("ORGANIZER");
      });
    } else {
      it("attaches nothing", () => {
        expect(mail.attachments ?? []).toHaveLength(0);
      });
    }
  });
});

describe("what a mail says about the venue", () => {
  it("uses the address, the phone and a map link only when the venue set them", () => {
    const withData = buildEmail("confirmation", { ...base, venue: full, booking: booking(1) }, "es");
    expect(withData.html).toContain("Calle Mayor 12, 28013 Madrid");
    expect(withData.html).toContain('href="tel:+34910000000"');
    expect(withData.html).toContain("https://www.google.com/maps/search/?api=1&amp;query=");
    const without = buildEmail("confirmation", { ...base, venue: bare, booking: booking(1) }, "es");
    expect(without.html).not.toContain("google.com/maps");
    expect(without.html).not.toContain("tel:");
    expect(without.html).not.toContain("Dónde");
    expect(without.html).not.toContain("Teléfono");
  });

  it("writes the day and the party in the locale, in the venue's own calendar day", () => {
    const mail = buildEmail("confirmation", { ...base, venue: full, booking: booking(1) }, "es");
    expect(mail.text).toContain("martes 1 de diciembre");
    expect(mail.subject).toBe("Reserva confirmada en Casa Paco: mar 1 dic, 20:30");
    expect(partyLabel("es", 1)).toBe("1 persona");
    expect(partyLabel("es", 4)).toBe("4 personas");
  });

  it("cuts a long venue name in the subject and never the day and time", () => {
    const mail = buildEmail("confirmation", { ...base, venue: longName }, "es");
    expect(mail.subject.length).toBeLessThanOrEqual(MAX_SUBJECT_LENGTH);
    expect(mail.subject).toContain("…");
    expect(mail.subject.endsWith("mar 1 dic, 20:30")).toBe(true);
  });

  it("never carries guest-typed text in a mail to the guest or its calendar file", () => {
    const sneaky = { ...base, venue: full, booking: booking(1), guestName: "Mallory", notes: "MalloryNote", commentary: "MalloryComment" };
    for (const [kind, version] of [["confirmation", 1], ["confirmation", 2], ["cancellation", 3]] as const) {
      const { html, text, subject, attachments } = buildEmail(kind, { ...sneaky, booking: booking(version) } as never, "es");
      const ics = attachments.map((a) => Buffer.from(a.content, "base64").toString("utf8")).join("");
      for (const part of [html, text, subject, ics]) expect(part).not.toContain("Mallory");
    }
    const link = buildLinkEmail([{ date: base.date, time: base.time, partySize: 2, url: "https://x.test/r#t" }], "es", full);
    expect(link.html + link.text + link.subject).not.toContain("Mallory");
  });

  it("names the guest in the venue's notice as one safe line of text, never a link", () => {
    const mail = buildEmail("notice", { ...base, venue: full }, "es");
    expect(mail.text).toContain("A nombre de: Mallory <b>x</b> https://evil.example/x Bcc: a@b.c Subject: hi\n");
    expect(mail.text.split("\n").some((l) => /^(Bcc|Subject):/.test(l))).toBe(false);
    expect(mail.html).toContain("Mallory &lt;b&gt;x&lt;/b&gt; https://evil.example/x Bcc: a@b.c Subject: hi");
    expect(mail.html).not.toContain("<b>x</b>");
    expect(mail.html).not.toMatch(/<a [^>]*evil\.example/);
    expect(mail.subject).not.toContain("Mallory");
    const long = buildEmail("notice", { ...base, venue: full, guestName: "ñ".repeat(200) }, "es");
    expect(long.text).toContain(`A nombre de: ${"ñ".repeat(79)}…\n`);
    expect(buildEmail("notice", { ...base, venue: full, guestName: " \n\t " }, "es").html).not.toContain("A nombre de");
  });

  it("leaves the self-service link out of the confirmation while the stage is off", () => {
    expect(GUEST_MANAGE_LINK_ENABLED).toBe(false);
    const withUrl = { ...base, venue: full, booking: booking(1), manageUrl: "https://reservas.example.com/r?lang=es#secret" };
    for (const kind of ["confirmation", "cancellation", "notice"] as const) {
      const mail = buildEmail(kind, withUrl, "es");
      expect(mail.html).not.toContain("secret");
      expect(mail.text).not.toContain("secret");
      expect(mail.html).not.toContain(EMAIL_CATALOGS.es["confirmation.manage"]);
    }
  });

  it("has the manage slot ready: on, the confirmation gets its button, a change does too, a cancel and a notice never", () => {
    const withUrl = { ...base, venue: full, booking: booking(1), manageUrl: "https://reservas.example.com/r?lang=es#secret" };
    const on = buildEmail("confirmation", withUrl, "es", { manageLinkEnabled: true });
    expect(on.html).toContain("Gestionar mi reserva");
    expect(on.text).toContain("Gestionar mi reserva: https://reservas.example.com/r?lang=es#secret");
    expect(buildEmail("confirmation", { ...withUrl, manageUrl: undefined }, "es", { manageLinkEnabled: true }).html).not.toContain("Gestionar");
    expect(buildEmail("cancellation", withUrl, "es", { manageLinkEnabled: true }).html).not.toContain("secret");
    expect(buildEmail("notice", withUrl, "es", { manageLinkEnabled: true }).html).not.toContain("secret");
  });
});

describe("colors", () => {
  const pairs = (p: typeof LIGHT | typeof DARK): [string, string, string][] => [
    ["ink on page", p.ink, p.page],
    ["ink on card", p.ink, p.card],
    ["ink on panel", p.ink, p.panel],
    ["muted on page", p.muted, p.page],
    ["muted on card", p.muted, p.card],
    ["muted on panel", p.muted, p.panel],
    ["link on card", p.link, p.card],
    ["link on panel", p.link, p.panel],
    ["button text on button", p.onAccent, p.accent],
  ];

  it.each([...pairs(LIGHT).map((x) => ["light", ...x] as const), ...pairs(DARK).map((x) => ["dark", ...x] as const)])(
    "%s: %s is at least 4.5:1",
    (_mode, _name, fg, bg) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("never uses pure black or white for text, so forced inversion does not flip it hard", () => {
    expect(LIGHT.ink).not.toBe("#000000");
    expect(DARK.ink).not.toBe("#ffffff");
  });

  it("keeps a venue's button colors only when they pass 4.5:1, and falls back to the brand's otherwise", () => {
    const good = accentFor({ primary: "#7a1f3d", onPrimary: "#ffffff" });
    expect(good.accent).toBe("#7a1f3d");
    expect(contrast(good.onAccent, good.accent)).toBeGreaterThanOrEqual(4.5);
    expect(accentFor({ primary: "#ffe066", onPrimary: "#ffffff" })).toEqual(DEFAULT_ACCENT);
    expect(accentFor({ primary: "javascript:alert(1)" })).toEqual(DEFAULT_ACCENT);
    expect(accentFor(undefined)).toEqual(DEFAULT_ACCENT);
    for (const theme of [accentFor({ primary: "#102a43" }), accentFor({ primary: "#d64545", onPrimary: "#000000" }, { primary: "#ffb3b3", onPrimary: "#2b0a0a" })]) {
      expect(contrast(theme.onAccent, theme.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.darkOnAccent, theme.darkAccent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("applies a venue's accent to the button, the VML button and the bar", () => {
    const { html } = buildEmail("confirmation", { ...base, venue: full, booking: booking(1) }, "es");
    expect(html).toContain("background-color:#7a1f3d");
    expect(html).toContain('fillcolor="#7a1f3d"');
    expect(html).toContain("<!--[if mso]><v:roundrect");
  });

  it("uses a venue logo only over https, on its own white tile", () => {
    expect(buildEmail("confirmation", { ...base, venue: full }, "es").html).toContain("https://cdn.example.com/logo.png");
    const insecure = emailVenue({ name: "X", publicStreet: null, publicLocality: null, publicPostalCode: null, publicPhone: null }, { logoUrl: "http://cdn.example.com/logo.png" });
    expect(insecure.logoUrl).toBeUndefined();
  });
});

describe("catalog copy", () => {
  it.each(Object.keys(EMAIL_CATALOGS))("%s has no long dash, no double space and no stray whitespace", (locale) => {
    for (const [id, text] of Object.entries(EMAIL_CATALOGS[locale]!)) {
      expect(text, id).not.toContain("—");
      expect(text, id).not.toMatch(/ {2}/);
      expect(text, id).toBe(text.trim());
    }
  });

  it("writes Spanish with its accents", () => {
    const es = Object.values(EMAIL_CATALOGS.es!).join("\n") + Object.values(MAGIC_LINK_CATALOGS.es).join("\n");
    for (const wrong of [/\bDia\b/, /\bAnadir\b/, /\bCancelacion\b/, /pedido tu,/, /\bConfirmacion\b/, /\bTelefono\b/, /\bDonde\b/]) {
      expect(es).not.toMatch(wrong);
    }
    expect(MAGIC_LINK_CATALOGS.es.outro).toBe("Si no lo has pedido tú, ignora este mensaje.");
  });
});
