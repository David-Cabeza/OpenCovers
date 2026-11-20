import { afterEach, describe, expect, it, vi } from "vitest";
import { magicLinkEmail } from "../src/lib/auth";
import { DEFAULT_ACCENT, escapeHtml, LOGO_URL, renderEmailHtml, renderEmailText } from "../src/lib/email-layout";
import { buildEmail, buildLinkEmail, sendEmail } from "../src/lib/mailer";

const ctx = { date: "2026-12-01", time: "20:30", partySize: 4, service: "dinner" };

afterEach(() => vi.unstubAllGlobals());

describe("email layout", () => {
  it("escapes every interpolated value", () => {
    const evil = `<script>alert("x")</script> & 'q'`;
    const html = renderEmailHtml({
      brand: { kind: "venue", name: evil, logoUrl: 'https://x.test/a.png"><x' },
      preheader: evil,
      heading: evil,
      blocks: [
        { kind: "paragraph", text: evil },
        { kind: "note", text: evil },
        { kind: "summary", rows: [{ label: evil, value: evil, href: "https://x.test/?a=1&b=<2>" }] },
        { kind: "button", label: evil, url: `https://example.com/r?a=1&b="2"#<t>`, showUrl: true },
      ],
      footer: evil,
      footerNote: evil,
      lang: 'es"><x',
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('"><x');
    expect(html).not.toContain("<x ");
    expect(html).toContain(escapeHtml(evil));
    expect(html).not.toContain('b="2"');
  });

  it("renders a button as VML for Outlook and a link for the rest, with the plain URL under it when asked", () => {
    const url = "https://app.example/r?lang=es#token";
    const html = renderEmailHtml({
      brand: { kind: "opencovers" },
      preheader: "p",
      heading: "h",
      blocks: [{ kind: "button", label: "Entrar", url, showUrl: true }],
      footer: "f",
      lang: "es",
    });
    expect(html).toContain(`<a class="btn-a c-btn-a" href="${url}"`);
    expect(html).toContain(`<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"`);
    expect(html).toContain(`>${url}</a>`);
    expect(html).toContain(LOGO_URL);
  });

  it("drops a button or link whose URL is not http(s) or tel:", () => {
    const html = renderEmailHtml({
      brand: { kind: "opencovers" },
      preheader: "p",
      heading: "h",
      blocks: [
        { kind: "button", label: "x", url: "javascript:alert(1)" },
        { kind: "summary", rows: [{ label: "a", value: "b", href: "data:text/html,x" }] },
      ],
      footer: "f",
      lang: "es",
    });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
  });

  it("renders text from the same blocks", () => {
    const text = renderEmailText({
      brand: { kind: "venue", name: "Casa" },
      preheader: "p",
      heading: "Hola",
      blocks: [
        { kind: "paragraph", text: "uno" },
        { kind: "summary", rows: [{ label: "Día", value: "martes" }] },
        { kind: "button", label: "Ir", url: "https://x.test/a" },
        { kind: "button", label: "Mal", url: "javascript:1" },
      ],
      footer: "Pie",
      footerNote: "Nota",
      lang: "es",
    });
    expect(text).toBe("Casa\n\nHola\n\nuno\n\nDía: martes\n\nIr: https://x.test/a\n\n--\nNota\nPie\n");
  });

  it("leads with the venue name and carries only the small credit for a guest mail", () => {
    const { html } = buildEmail("confirmation", { ...ctx, venue: { name: "Casa <Paco>", accent: DEFAULT_ACCENT } }, "es");
    expect(html).toContain("Casa &lt;Paco&gt;");
    expect(html).toContain("Reservas con OpenCovers");
    expect(html).not.toContain(LOGO_URL);
  });

  it("builds the self-service mail with one button per booking and the printed link", () => {
    const lines = [
      { date: "2026-12-01", time: "20:30", partySize: 2, url: "https://x.example/r?lang=es#a" },
      { date: "2026-12-02", time: "21:00", partySize: 3, url: "https://x.example/r?lang=es#b" },
    ];
    const { text, html } = buildLinkEmail(lines, "es");
    expect(html.match(/>Gestionar mi reserva<\/a>/g)).toHaveLength(2);
    expect(html).toContain(">https://x.example/r?lang=es#b</a>");
    expect(text).toContain("Gestionar mi reserva: https://x.example/r?lang=es#a");
    expect(text).toContain("Gestionar mi reserva: https://x.example/r?lang=es#b");
    expect(text).toContain("Día: martes 1 de diciembre");
    expect(text).toContain("Día: miércoles 2 de diciembre");
    expect(text).toContain("Los enlaces anteriores ya no funcionan.");
  });

  it("builds the magic link fully branded", () => {
    const url = "https://demo.example/api/auth/magic-link/verify?token=t&callbackURL=%2F";
    const es = magicLinkEmail("es-ES", url);
    expect(es.subject).toBe("Tu enlace para entrar en la demo de OpenCovers");
    expect(es.text).toContain(`Entrar en la demo: ${url}`);
    expect(es.text).toContain("Si no lo has pedido tú, ignora este mensaje.");
    expect(es.html).toContain(LOGO_URL);
    expect(es.html).toContain(">https://demo.example/api/auth/magic-link/verify?token=t&amp;callbackURL=%2F</a>");
    expect(es.html).toContain('lang="es"');
    expect(magicLinkEmail("en", url).html).toContain('lang="en"');
    expect(magicLinkEmail("fr", url).subject).toBe("Your link to the OpenCovers demo");
  });
});

describe("sendEmail", () => {
  const capture = (statuses: number[] = [200]) => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response("{}", { status: statuses[Math.min(bodies.length - 1, statuses.length - 1)] });
    });
    return bodies;
  };

  it("sends html and text together, and text alone when there is no html", async () => {
    const bodies = capture();
    await sendEmail("k", "from@x.test", "to@x.test", "s", "plain", "<p>hi</p>");
    await sendEmail("k", "from@x.test", "to@x.test", "s", "plain");
    expect(bodies[0]).toEqual({ from: "from@x.test", to: ["to@x.test"], subject: "s", text: "plain", html: "<p>hi</p>" });
    expect(bodies[1]).toEqual({ from: "from@x.test", to: ["to@x.test"], subject: "s", text: "plain" });
  });

  it("sends attachments in Resend's shape: a file name and Base64 content", async () => {
    const bodies = capture();
    await sendEmail("k", "from@x.test", "to@x.test", "s", "plain", "<p>hi</p>", [{ filename: "reserva.ics", content: "QkVHSU4=" }]);
    expect(bodies[0]).toEqual({
      from: "from@x.test",
      to: ["to@x.test"],
      subject: "s",
      text: "plain",
      html: "<p>hi</p>",
      attachments: [{ filename: "reserva.ics", content: "QkVHSU4=" }],
    });
  });

  it("sends the mail again without the calendar file when Resend refuses the request", async () => {
    const bodies = capture([422, 200]);
    await sendEmail("k", "from@x.test", "to@x.test", "s", "plain", "<p>hi</p>", [{ filename: "reserva.ics", content: "QkVHSU4=" }]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("attachments");
    expect(bodies[1]).not.toHaveProperty("attachments");
    expect(bodies[1]).toMatchObject({ subject: "s", html: "<p>hi</p>" });
  });

  it("does not retry other failures, and throws", async () => {
    const bodies = capture([500]);
    await expect(sendEmail("k", "from@x.test", "to@x.test", "s", "plain", undefined, [{ filename: "a.ics", content: "x" }])).rejects.toThrow("Resend 500");
    expect(bodies).toHaveLength(1);
  });
});
