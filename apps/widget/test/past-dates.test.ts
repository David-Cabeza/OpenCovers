import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimeList } from "../src/App";
import { translator } from "../src/messages";
import { VenueHeader } from "../src/ui";

const t = translator("en");

function list(times: Parameters<typeof TimeList>[0]["times"]) {
  return renderToStaticMarkup(
    createElement(TimeList, { times, t, party: 2, name: "t", value: "", onChange: () => {}, explain: () => "" }),
  );
}

describe("the time list when a date has no times", () => {
  it("says to choose a date from today for a past date", () => {
    expect(list({ kind: "loaded", times: [], reason: "past_date" })).toContain("Choose a date from today");
  });

  it("says it is too far ahead past the horizon", () => {
    expect(list({ kind: "loaded", times: [], reason: "beyond_horizon" })).toContain("too far ahead");
  });

  it("keeps the no-free-times message for any other empty answer", () => {
    expect(list({ kind: "loaded", times: [], reason: null })).toContain("No free times left");
  });
});

describe("the venue header", () => {
  it("shows the name and the phone, escaped", () => {
    const html = renderToStaticMarkup(
      createElement(VenueHeader, { venue: { name: "Casa <b>Alba</b>", phone: "+34 910 000 000", theme: {} } }),
    );
    expect(html).toContain("Casa &lt;b&gt;Alba&lt;/b&gt;");
    expect(html).toContain("+34 910 000 000");
  });

  it("omits the phone when the venue has none", () => {
    const html = renderToStaticMarkup(createElement(VenueHeader, { venue: { name: "Casa", phone: null } }));
    expect(html).toContain("Casa");
    expect(html.match(/<p /g)).toHaveLength(1);
  });
});
