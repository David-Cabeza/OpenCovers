import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readViewParam, setViewParam, visibleView } from "./view-param";

const go = (url: string) => window.history.replaceState(null, "", url);

describe("view param", () => {
  beforeEach(() => go("/"));
  afterEach(() => go("/"));

  it("reads a valid screen", () => {
    go("/?view=floor");
    expect(readViewParam()).toBe("floor");
  });

  it.each(["", "nope", "FLOOR", "agenda,floor"])("ignores %j", (bad) => {
    go(`/?view=${bad}`);
    expect(readViewParam()).toBeNull();
  });

  it("is null with no param", () => {
    expect(readViewParam()).toBeNull();
  });

  it("falls back to the agenda for a screen the role cannot see", () => {
    expect(visibleView("team", "read")).toBe("agenda");
    expect(visibleView("team", "write")).toBe("agenda");
    expect(visibleView("team", "admin")).toBe("team");
    expect(visibleView("setup", "read")).toBe("setup");
  });

  it("writes the screen, keeping other params and the hash, without adding history", () => {
    go("/?date=2026-12-06&section=online#top");
    const before = window.history.length;
    setViewParam("waitlist");
    expect(window.location.search).toBe("?date=2026-12-06&section=online&view=waitlist");
    expect(window.location.hash).toBe("#top");
    expect(window.history.length).toBe(before);
  });

  it("removes the param for the agenda and keeps the rest", () => {
    go("/?view=floor&date=2026-12-06");
    setViewParam("agenda");
    expect(window.location.search).toBe("?date=2026-12-06");
  });
});
