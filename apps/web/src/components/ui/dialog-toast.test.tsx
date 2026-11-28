import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/lib/theme";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

function renderOpenDialog() {
  const changes: boolean[] = [];
  render(
    <ThemeProvider>
      <Dialog open onOpenChange={(open) => changes.push(open)}>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Body</DialogDescription>
        </DialogContent>
      </Dialog>
      <Toaster />
    </ThemeProvider>,
  );
  return changes;
}

describe("a toast while a dialog is open", () => {
  afterEach(() => act(() => void toast.dismiss()));

  it("can be dismissed without closing the dialog", async () => {
    // Radix turns pointer events off on <body>; the stylesheet that turns them back on for toasts is not loaded here.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const changes = renderOpenDialog();
    act(() => void toast.error("Could not save"));
    // Sonner captures the pointer on a toast, which jsdom does not implement.
    Element.prototype.setPointerCapture ??= () => {};
    Element.prototype.releasePointerCapture ??= () => {};
    await user.click(await screen.findByText("Could not save"));
    await user.click(document.querySelector<HTMLElement>("[data-close-button]")!);

    await waitFor(() => expect(screen.queryByText("Could not save")).not.toBeInTheDocument());
    expect(changes).toEqual([]);
  });

  it("marks the page while a toast shows, so the dialog can make room for it", async () => {
    renderOpenDialog();
    const root = document.documentElement;
    expect(root).not.toHaveAttribute("data-toast");
    let id: string | number = "";
    act(() => void (id = toast.success("Saved")));
    await waitFor(() => expect(root).toHaveAttribute("data-toast"));
    act(() => void toast.dismiss(id));
    await waitFor(() => expect(root).not.toHaveAttribute("data-toast"));
  });
});
