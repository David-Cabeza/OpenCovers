import { afterEach, describe, expect, it, vi } from "vitest";
import { magicLinkEmail } from "../src/lib/auth";
import { escapeHtml, LOGO_URL, renderEmailHtml } from "../src/lib/email-layout";
import { formatEmailDate } from "../src/lib/email-messages";
import { buildEmail, buildLinkEmail, sendEmail } from "../src/lib/mailer";

const ctx = { date: "2026-12-01", time: "20:30", partySize: 4, guestName: "Ana", service: "dinner" };
const D1 = formatEmailDate("2026-12-01", "es");
const D2 = formatEmailDate("2026-12-02", "es");

afterEach(() => vi.unstubAllGlobals());

describe("email layout", () => {
  it("escapes every interpolated value", () => {
    const evil = `<script>alert("x")</script> & 'q'`;
    const html = renderEmailHtml({
      brand: { kind: "venue", name: evil },
      preheader: evil,
      heading: evil,
      blocks: [
        { kind: "paragraph", text: evil },
        { kind: "details", rows: [{ label: evil, value: evil }] },
        { kind: "button", label: evil, url: `https://example.com/r?a=1&b="2"#<t>` },
      ],
      footer: evil,
      lang: 'es"><x',
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<x");
    expect(html).toContain(escapeHtml(evil));
    expect(html).not.toContain('b="2"');
  });

  it("renders a button with the plain URL printed under it", () => {
    const url = "https://app.example/r?lang=es#token";
    const html = renderEmailHtml({
      brand: { kind: "opencovers" },
      heading: "h",
      blocks: [{ kind: "button", label: "Entrar", url }],
      footer: "f",
      lang: "es",
    });
    expect(html).toContain(`<a href="${url}"`);
    expect(html).toContain(`>${url}</a>`);
    expect(html).toContain(LOGO_URL);
  });

  it("drops a button whose URL is not http(s)", () => {
    const html = renderEmailHtml({
      brand: { kind: "opencovers" },
      heading: "h",
      blocks: [{ kind: "button", label: "x", url: "javascript:alert(1)" }],
      footer: "f",
      lang: "es",
    });
    expect(html).not.toContain("javascript:");
  });

  it("leads with the venue name and carries only the small credit for a guest mail", () => {
    const { html } = buildEmail("confirmation", { ...ctx, venueName: "Casa <Paco>" }, "es");
    expect(html).toContain("Casa &lt;Paco&gt;");
    expect(html).toContain("Reservas con OpenCovers");
    expect(html).not.toContain(LOGO_URL);
  });

  it("never puts the guest name in a guest mail, and keeps the text part unchanged", () => {
    for (const kind of ["confirmation", "cancellation"] as const) {
      const { html, text } = buildEmail(kind, { ...ctx, guestName: "Mallory", venueName: "Casa" }, "es");
      expect(html).not.toContain("Mallory");
      expect(text).not.toContain("Mallory");
    }
    expect(buildEmail("confirmation", ctx, "es").text).toBe(
      `Hola, tu reserva para 4 personas el ${D1} a las 20:30 está confirmada.`,
    );
    expect(buildEmail("cancellation", ctx, "es").text).toBe(`Hola, tu reserva del ${D1} a las 20:30 ha sido cancelada.`);
    expect(buildEmail("notice", ctx, "es").text).toBe(`Nueva reserva para 4 personas el ${D1} a las 20:30 (Ana).`);
  });

  it("builds the self-service mail with one button per booking and the old text", () => {
    const lines = [
      { date: "2026-12-01", time: "20:30", partySize: 2, url: "https://x.example/r?lang=es#a" },
      { date: "2026-12-02", time: "21:00", partySize: 3, url: "https://x.example/r?lang=es#b" },
    ];
    const { text, html } = buildLinkEmail(lines, "es", "Casa");
    expect(text).toBe(
      "Hola, aquí tienes un enlace nuevo para ver, cambiar o cancelar tu reserva:\n\n" +
        `- ${D1} a las 20:30, 2 personas: https://x.example/r?lang=es#a\n` +
        `- ${D2} a las 21:00, 3 personas: https://x.example/r?lang=es#b\n\n` +
        "Los enlaces anteriores ya no funcionan.",
    );
    expect(html.match(/Gestionar mi reserva/g)).toHaveLength(2);
    expect(html).toContain(">https://x.example/r?lang=es#b</a>");
  });

  it("builds the magic link as fully branded html plus the old text", () => {
    const url = "https://demo.example/api/auth/magic-link/verify?token=t&callbackURL=%2F";
    const es = magicLinkEmail("es-ES", url);
    expect(es.text).toBe(
      `Abre este enlace para entrar en la demo de OpenCovers (caduca en 5 minutos):\n\n${url}\n\nSi no lo has pedido tu, ignora este mensaje.`,
    );
    expect(es.html).toContain(LOGO_URL);
    expect(es.html).toContain("Entrar en la demo");
    expect(es.html).toContain(">https://demo.example/api/auth/magic-link/verify?token=t&amp;callbackURL=%2F</a>");
    expect(magicLinkEmail("en", url).html).toContain('lang="en"');
  });

  it("sends html and text together, and text alone when there is no html", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    });
    await sendEmail("k", "from@x.test", "to@x.test", "s", "plain", "<p>hi</p>");
    await sendEmail("k", "from@x.test", "to@x.test", "s", "plain");
    expect(bodies[0]).toEqual({ from: "from@x.test", to: ["to@x.test"], subject: "s", text: "plain", html: "<p>hi</p>" });
    expect(bodies[1]).toEqual({ from: "from@x.test", to: ["to@x.test"], subject: "s", text: "plain" });
  });
});
