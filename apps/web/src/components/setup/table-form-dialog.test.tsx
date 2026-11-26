import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Table } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import { useUiStore } from "@/stores/ui-store";
import { TableFormDialog } from "./table-form-dialog";

function mockApi() {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ tables: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return posts;
}

function renderDialog(initial?: Table) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TableFormDialog venueId="v1" open onOpenChange={() => {}} initial={initial ?? null} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const STORED: Table = { id: "t1", name: "Table 1", seats: 4, zone: "Main", shape: "round", posX: 0, posY: 0, rotation: 0 };

const ID_MESSAGE =
  "Use up to 64 characters: letters without accents, digits, dot, underscore or hyphen. Start with a letter or digit.";
const SEATS_MESSAGE = "Seats must be a whole number from 1 to 200.";

async function fill(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  await user.click(field);
  await user.paste(value);
}

async function submitNew(values: Partial<Record<"ID" | "Name" | "Seats" | "Zone", string>>) {
  const user = userEvent.setup();
  const posts = mockApi();
  renderDialog();
  for (const [label, value] of Object.entries({ ID: "t1", Name: "Table 1", ...values })) {
    await fill(user, label, value);
  }
  await user.click(screen.getByRole("button", { name: "Add table" }));
  return posts;
}

describe("TableFormDialog limits", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useUiStore.setState({ locale: "en" });
  });

  it.each([
    ["ID", "a".repeat(65), ID_MESSAGE],
    ["ID", "table 1", ID_MESSAGE],
    ["ID", "..", ID_MESSAGE],
    ["ID", "mesa-ñ", ID_MESSAGE],
    ["Name", "   ", "Name is required."],
    ["Name", "n".repeat(81), "Name can be up to 80 characters."],
    ["Seats", "0", SEATS_MESSAGE],
    ["Seats", "201", SEATS_MESSAGE],
    ["Seats", "2.5", SEATS_MESSAGE],
    ["Zone", "z".repeat(81), "Zone can be up to 80 characters."],
  ])("says what is wrong with %s %j and sends nothing", async (label, value, message) => {
    const posts = await submitNew({ [label]: value });

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText(label)).toHaveAccessibleDescription(message);
    expect(screen.getByLabelText(label)).toBeInvalid();
    expect(posts).toHaveLength(0);
  });

  it("sends values that sit exactly on the limits", async () => {
    const id = `A._-${"1".repeat(60)}`;
    const posts = await submitNew({ ID: id, Name: "n".repeat(80), Seats: "200", Zone: "z".repeat(80) });

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ id, name: "n".repeat(80), seats: 200, zone: "z".repeat(80) });
  });

  it("says the limits in Spanish", async () => {
    useUiStore.setState({ locale: "es" });
    const user = userEvent.setup();
    renderDialog();
    await fill(user, "ID", "mesa 1");
    await fill(user, "Nombre", "n".repeat(81));
    await fill(user, "Plazas", "201");
    await fill(user, "Zona", "z".repeat(81));
    await user.click(screen.getByRole("button", { name: "Añadir mesa" }));

    for (const message of [
      "Usa como máximo 64 caracteres: letras sin acentos, números, punto, guion bajo o guion. Empieza por una letra o un número.",
      "El nombre admite como máximo 80 caracteres.",
      "Las plazas deben ser un número entero del 1 al 200.",
      "La zona admite como máximo 80 caracteres.",
    ]) {
      expect(await screen.findByText(message)).toBeInTheDocument();
    }
  });

  it("does not hold a stored id to the new rules when editing", async () => {
    const user = userEvent.setup();
    const posts = mockApi();
    const id = `old id ${"x".repeat(70)}`;
    renderDialog({ ...STORED, id });

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ id });
  });

  it("saves a table stored with the older shape name rect", async () => {
    const user = userEvent.setup();
    const posts = mockApi();
    renderDialog({ ...STORED, shape: "rect" });

    expect(screen.getByLabelText("Shape")).toHaveValue("rectangle");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ shape: "rectangle" });
  });
});
