import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { publicApi, type Result } from "../src/api";
import { explainResend } from "../src/errors";
import { LostLink } from "../src/LostLink";
import { CATALOGS, translator } from "../src/messages";
import { emailLooksValid } from "../src/validate";

const fail = (code: string, retryable = false): Result<never> => ({ ok: false, failure: { kind: "error", code, retryable } });

describe("what the guest reads after asking for a lost link", () => {
  it("reads the same neutral answer for a 202 and for every refusal but a rate limit", () => {
    const neutral = explainResend({ ok: true, value: { accepted: true } });
    expect(neutral).toBe("lost.sent");
    for (const code of ["invalid_request", "venue_not_found", "internal_error", "unknown"]) {
      expect(explainResend(fail(code)), code).toBe(neutral);
    }
    expect(explainResend({ ok: false, failure: { kind: "local" } })).toBe(neutral);
  });

  it("tells a failed connection and a rate limit apart, with no word on any booking", () => {
    expect(explainResend({ ok: false, failure: { kind: "network" } })).toBe("error.network");
    expect(explainResend(fail("rate_limited", true))).toBe("error.rateLimited");
  });

  it("says in every locale that a link went out only if a booking exists", () => {
    expect(CATALOGS.es["lost.sent"]).toMatch(/^Si hay una reserva/);
    expect(CATALOGS.en["lost.sent"]).toMatch(/^If there is a booking/);
  });
});

describe("the resend request", () => {
  it("posts only the trimmed email to the resend route, with no cookie and nothing cached", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const api = publicApi("pk_abc", async (url, init) => {
      sent.push({ url, init });
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    });
    expect(await api.resendLink("  ana@example.com ")).toEqual({ ok: true, value: { accepted: true } });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/v1/public/pk_abc/self-service/resend");
    expect(sent[0].init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(JSON.parse(String(sent[0].init.body))).toEqual({ email: "ana@example.com" });
  });

  it("checks the address before sending", () => {
    for (const ok of ["ana@example.com", " ana@example.com "]) expect(emailLooksValid(ok), ok).toBe(true);
    for (const bad of ["", "ana", "ana@example", "+34 600 000 000", `${"a".repeat(250)}@x.es`]) {
      expect(emailLooksValid(bad), bad).toBe(false);
    }
  });
});

describe("the lost-link entry", () => {
  it("starts closed, with a labelled email field inside a hidden panel", () => {
    const api = { resendLink: async () => ({ ok: true as const, value: { accepted: true as const } }) };
    for (const locale of ["es", "en"] as const) {
      const t = translator(locale);
      const html = renderToStaticMarkup(createElement(LostLink, { api, t }));
      expect(html).toContain(`aria-expanded="false"`);
      expect(html).toMatch(/<div id="[^"]+-panel" hidden=""/);
      expect(html).toContain(t("lost.open"));
      expect(html).toMatch(/<label for="([^"]+-email)"[^>]*>[^<]+<\/label>.*id="\1"/);
      expect(html).toContain(`type="email"`);
      expect(html.toLowerCase()).toContain(`autocomplete="email"`);
      expect(html).not.toContain(t("lost.sent"));
    }
  });
});
