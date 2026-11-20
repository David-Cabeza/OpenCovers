import { describe, expect, it } from "vitest";
import { buildIcs, foldLine, icsInstant, icsText, icsUid, type IcsEvent } from "../src/lib/ics";
import { parseIcs } from "./ics-parse";

const event: IcsEvent = {
  uid: icsUid("venue-1", "res-1"),
  sequence: 3,
  start: new Date("2026-12-01T19:30:00Z"),
  end: new Date("2026-12-01T21:30:00Z"),
  summary: "Reserva en Casa Paco",
  location: "Casa Paco, Calle Mayor 12, 28013 Madrid",
  description: "Reserva para 4 personas.",
  status: "CONFIRMED",
  method: "PUBLISH",
  stamp: new Date("2026-11-20T10:00:00Z"),
  alarm: "Tu reserva es en 2 horas, a las 20:30.",
};

describe("ics", () => {
  it("builds a file a strict reader accepts, with UTC instants from the stored ones", () => {
    const ics = parseIcs(buildIcs(event));
    expect(ics.get("DTSTART")).toBe("20261201T193000Z");
    expect(ics.get("DTEND")).toBe("20261201T213000Z");
    expect(ics.get("SEQUENCE")).toBe("3");
    expect(ics.get("STATUS")).toBe("CONFIRMED");
    expect(ics.get("LOCATION")).toBe("Casa Paco, Calle Mayor 12, 28013 Madrid");
    expect(ics.calendar.find((p) => p.name === "METHOD")?.value).toBe("PUBLISH");
    expect(ics.alarm.find((p) => p.name === "TRIGGER")?.value).toBe("-PT2H");
  });

  it("builds a cancellation with the same UID, a higher sequence and no alarm", () => {
    const cancel = parseIcs(buildIcs({ ...event, sequence: 4, status: "CANCELLED", method: "CANCEL" }));
    const confirm = parseIcs(buildIcs(event));
    expect(cancel.get("UID")).toBe(confirm.get("UID"));
    expect(Number(cancel.get("SEQUENCE"))).toBeGreaterThan(Number(confirm.get("SEQUENCE")));
    expect(cancel.get("STATUS")).toBe("CANCELLED");
    expect(cancel.calendar.find((p) => p.name === "METHOD")?.value).toBe("CANCEL");
    expect(cancel.alarm).toHaveLength(0);
  });

  it("keeps a stable uid per reservation that does not reveal its id", () => {
    expect(icsUid("v", "r")).toBe(icsUid("v", "r"));
    expect(icsUid("v", "r")).not.toBe(icsUid("v", "r2"));
    expect(icsUid("v", "r")).not.toBe(icsUid("v2", "r"));
    expect(icsUid("venue", "reservation-id")).not.toContain("reservation-id");
    expect(icsUid("v", "r")).toMatch(/^[0-9a-f]{32}@opencovers\.dev$/);
  });

  it("escapes TEXT and cannot be injected through a value", () => {
    expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const hostile = "x\r\nATTENDEE:mailto:evil@example.com\r\nEND:VEVENT";
    const ics = buildIcs({ ...event, summary: hostile, location: hostile, description: hostile });
    const parsed = parseIcs(ics);
    expect(parsed.event.some((p) => p.name === "ATTENDEE")).toBe(false);
    expect(parsed.get("SUMMARY")).toContain("ATTENDEE:mailto:evil@example.com");
  });

  it("folds long lines at 75 octets without splitting a character, and unfolding restores them", () => {
    const long = `DESCRIPTION:${"ñandú, café – 🍽️ ".repeat(20)}`;
    const folded = foldLine(long);
    for (const line of folded.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    const parsed = parseIcs(buildIcs({ ...event, description: "ñandú, café – 🍽️ ".repeat(20) }));
    expect(parsed.get("DESCRIPTION")).toBe("ñandú, café – 🍽️ ".repeat(20));
  });

  it("writes instants as UTC basic format", () => {
    expect(icsInstant(new Date("2026-03-29T01:30:00.000Z"))).toBe("20260329T013000Z");
  });

  it("the strict reader rejects what it should", () => {
    const ok = buildIcs(event);
    expect(() => parseIcs(ok.replace(/\r\n/g, "\n"))).toThrow();
    expect(() => parseIcs(ok.replace("DTEND:20261201T213000Z", "DTEND:20261201T193000Z"))).toThrow();
    expect(() => parseIcs(ok.replace("END:VEVENT\r\n", ""))).toThrow();
    expect(() => parseIcs(ok.replace("SUMMARY:Reserva en Casa Paco", "SUMMARY:a, b"))).toThrow();
  });
});
