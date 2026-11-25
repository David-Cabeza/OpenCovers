import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Loading } from "@/components/ui/skeleton";
import { ThemeProvider } from "@/lib/theme";
import { useUiStore } from "@/stores/ui-store";

function renderToaster() {
  return render(
    <ThemeProvider>
      <Toaster />
    </ThemeProvider>,
  );
}

describe("Toaster", () => {
  afterEach(() => {
    vi.useRealTimers();
    toast.dismiss();
    useUiStore.setState({ locale: "en" });
  });

  it("labels the notification region in the language of the app", () => {
    useUiStore.setState({ locale: "es" });
    renderToaster();
    expect(screen.getByRole("region", { name: /^Notificaciones/ })).toBeInTheDocument();
  });

  it("keeps an error until it is dismissed and gives it a close button", () => {
    vi.useFakeTimers();
    renderToaster();
    act(() => {
      toast.error("Could not save");
      toast.success("Saved");
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText("Could not save")).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });
});

describe("Loading", () => {
  afterEach(() => useUiStore.setState({ locale: "en" }));

  it("is a busy status region with a text for screen readers", () => {
    render(<Loading>x</Loading>);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveTextContent("Loading…");
  });
});
