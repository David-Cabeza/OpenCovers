import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canEditSetup, useNavigation, useScrollToSection } from "./navigation";

describe("canEditSetup", () => {
  it("is true for write and admin only", () => {
    expect(canEditSetup("write")).toBe(true);
    expect(canEditSetup("admin")).toBe(true);
    expect(canEditSetup("read")).toBe(false);
    expect(canEditSetup(undefined)).toBe(false);
  });
});

describe("useNavigation", () => {
  it("is null outside the dashboard", () => {
    function Probe() {
      return <p>{useNavigation() === null ? "none" : "some"}</p>;
    }
    expect(render(<Probe />).getByText("none")).toBeInTheDocument();
  });
});

describe("useScrollToSection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function section(id: string) {
    const el = document.createElement("section");
    el.id = `settings-${id}`;
    el.scrollIntoView = vi.fn();
    document.body.append(el);
    return el;
  }

  it("scrolls to the section when it is already there, and says it is done", () => {
    const el = section("room");
    const done = vi.fn();
    renderHook(() => useScrollToSection("room", done));
    act(() => void vi.advanceTimersByTime(100));
    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("waits for a section that is drawn a moment later", () => {
    const done = vi.fn();
    renderHook(() => useScrollToSection("room", done));
    act(() => void vi.advanceTimersByTime(400));
    expect(done).not.toHaveBeenCalled();
    const el = section("room");
    act(() => void vi.advanceTimersByTime(100));
    expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("gives up after two seconds without scrolling anywhere", () => {
    const other = section("venue");
    const done = vi.fn();
    renderHook(() => useScrollToSection("room", done));
    act(() => void vi.advanceTimersByTime(2_000));
    expect(done).toHaveBeenCalledTimes(1);
    expect(other.scrollIntoView).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(5_000));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a section", () => {
    const done = vi.fn();
    renderHook(() => useScrollToSection(null, done));
    act(() => void vi.advanceTimersByTime(5_000));
    expect(done).not.toHaveBeenCalled();
  });
});
