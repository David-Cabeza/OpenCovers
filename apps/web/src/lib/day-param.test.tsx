import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { todayIso } from "@/lib/date";
import { useDayParam } from "./day-param";

const go = (url: string) => window.history.replaceState(null, "", url);

describe("useDayParam", () => {
  beforeEach(() => go("/"));
  afterEach(() => go("/"));

  it("reads a valid date from the address", () => {
    go("/?date=2026-12-06");
    const { result } = renderHook(() => useDayParam());
    expect(result.current[0]).toBe("2026-12-06");
  });

  it.each(["2026-13-45", "2026-02-30", "garbage", "2026-1-5", ""])("falls back to today for %j", (bad) => {
    go(`/?date=${bad}`);
    const { result } = renderHook(() => useDayParam());
    expect(result.current[0]).toBe(todayIso());
  });

  it("defaults to today with no param", () => {
    const { result } = renderHook(() => useDayParam());
    expect(result.current[0]).toBe(todayIso());
  });

  it("writes the day to the address without adding history entries", () => {
    const { result } = renderHook(() => useDayParam());
    const before = window.history.length;
    act(() => result.current[1]("2026-12-07"));
    expect(result.current[0]).toBe("2026-12-07");
    expect(window.location.search).toBe("?date=2026-12-07");
    expect(window.history.length).toBe(before);
  });

  it("removes the param when the day is today", () => {
    go("/?date=2026-12-06");
    const { result } = renderHook(() => useDayParam());
    act(() => result.current[1](todayIso()));
    expect(window.location.search).toBe("");
    expect(result.current[0]).toBe(todayIso());
  });

  it("keeps other params and the hash", () => {
    go("/?section=online#top");
    const { result } = renderHook(() => useDayParam());
    act(() => result.current[1]("2026-12-06"));
    expect(window.location.search).toBe("?section=online&date=2026-12-06");
    expect(window.location.hash).toBe("#top");
    act(() => result.current[1](todayIso()));
    expect(window.location.search).toBe("?section=online");
  });

  it("keeps two consumers in sync", () => {
    const a = renderHook(() => useDayParam());
    const b = renderHook(() => useDayParam());
    act(() => a.result.current[1]("2026-12-06"));
    expect(b.result.current[0]).toBe("2026-12-06");
  });
});
