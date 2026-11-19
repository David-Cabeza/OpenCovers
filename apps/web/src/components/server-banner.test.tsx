import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { useServerStatus } from "@/stores/server-status";
import { ServerBanner } from "./server-banner";

function show() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ServerBanner />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  useServerStatus.setState({ down: false });
});
afterEach(() => vi.useRealTimers());

describe("ServerBanner", () => {
  it("shows nothing while the server answers", () => {
    show();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("appears when a request fails because the server could not be reached, and goes when one gets an answer", async () => {
    show();
    await expect(
      queryClient.fetchQuery({ queryKey: ["a"], queryFn: () => Promise.reject(new TypeError("Failed to fetch")), retry: false }),
    ).rejects.toThrow();
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");

    await queryClient.fetchQuery({ queryKey: ["b"], queryFn: () => Promise.resolve(1) });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("also counts a failed save, and a gateway error", async () => {
    show();
    await queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: () => Promise.reject(new ApiError("error", 502)) })
      .execute(undefined)
      .catch(() => undefined);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("stays away for an error the API itself reported", async () => {
    show();
    await expect(
      queryClient.fetchQuery({ queryKey: ["c"], queryFn: () => Promise.reject(new ApiError("venue_not_found", 404)), retry: false }),
    ).rejects.toThrow();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(useServerStatus.getState().down).toBe(false);
  });

  it("asks the active queries again on request", async () => {
    const user = userEvent.setup();
    const fn = vi.fn().mockResolvedValue("ok");
    const observer = queryClient.getQueryCache().build(queryClient, { queryKey: ["live"], queryFn: fn });
    const sub = observer.addObserver(
      // an observer keeps the query active, as a mounted screen would
      new (await import("@tanstack/react-query")).QueryObserver(queryClient, { queryKey: ["live"], queryFn: fn, staleTime: 0 }),
    );
    void sub;
    useServerStatus.setState({ down: true });
    show();
    const before = fn.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(fn.mock.calls.length).toBeGreaterThan(before));
  });

  it("asks again by itself every fifteen seconds while it is down, and stops when it is up", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(queryClient, "refetchQueries").mockResolvedValue(undefined);
    useServerStatus.setState({ down: true });
    show();
    await act(async () => void vi.advanceTimersByTime(14_000));
    expect(spy).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(1_500));
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(15_000));
    expect(spy).toHaveBeenCalledTimes(2);
    act(() => useServerStatus.setState({ down: false }));
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
