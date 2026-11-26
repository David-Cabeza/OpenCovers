import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import type { Service } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import { formatDays } from "@/lib/weekdays";
import { ServiceFormDialog } from "./service-form-dialog";

function mockApi() {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ services: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return posts;
}

function renderDialog(initial?: Service) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ServiceFormDialog venueId="v1" open onOpenChange={() => {}} initial={initial ?? null} />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const DINNER: Service = { name: "dinner", openStart: "19:00", openEnd: "23:00", days: [4, 5, 6] };

describe("ServiceFormDialog weekdays", () => {
  afterEach(() => {
    toast.dismiss();
    vi.unstubAllGlobals();
  });

  it("starts a new service with every day selected and sends all seven", async () => {
    const user = userEvent.setup();
    const posts = mockApi();
    renderDialog();

    for (const day of ["Monday", "Sunday"]) {
      expect(screen.getByRole("checkbox", { name: day })).toBeChecked();
    }
    await user.type(screen.getByLabelText("Name"), "lunch");
    await user.click(screen.getByRole("button", { name: "Add service" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ name: "lunch", days: [1, 2, 3, 4, 5, 6, 7] });
  });

  it("loads the days of the service and saves an edited set", async () => {
    const user = userEvent.setup();
    const posts = mockApi();
    renderDialog(DINNER);

    expect(screen.getByRole("checkbox", { name: "Thursday" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Monday" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Thursday" }));
    await user.click(screen.getByRole("checkbox", { name: "Sunday" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ name: "dinner", days: [5, 6, 7] });
  });

  it("refuses to save with no day selected", async () => {
    const user = userEvent.setup();
    const posts = mockApi();
    renderDialog({ ...DINNER, days: [2] });

    await user.click(screen.getByRole("checkbox", { name: "Tuesday" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Pick at least one day.")).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    await user.click(screen.getByRole("checkbox", { name: "Friday" }));
    expect(screen.queryByText("Pick at least one day.")).not.toBeInTheDocument();
  });
});

describe("ServiceFormDialog name", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says a name over 200 characters is too long and sends nothing", async () => {
    const user = userEvent.setup();
    const posts = mockApi();
    renderDialog();

    await user.click(screen.getByLabelText("Name"));
    await user.paste("s".repeat(201));
    await user.click(screen.getByRole("button", { name: "Add service" }));

    expect(await screen.findByText("Name can be up to 200 characters.")).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });
});

describe("formatDays", () => {
  it("names the set compactly", () => {
    expect(formatDays([1, 2, 3, 4, 5, 6, 7])).toBe("Every day");
    expect(formatDays(undefined)).toBe("Every day");
    expect(formatDays([1, 2, 3, 4, 5])).toBe("Mon-Fri");
    expect(formatDays([7, 6])).toBe("Sat, Sun");
    expect(formatDays([1, 3, 4, 5])).toBe("Mon, Wed-Fri");
    expect(formatDays([2])).toBe("Tue");
  });
});
