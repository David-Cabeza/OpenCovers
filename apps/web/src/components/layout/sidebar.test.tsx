import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MobileNav, Sidebar } from "@/components/layout/sidebar";
import { useUiStore } from "@/stores/ui-store";
import { renderWithApp } from "@/test/mock-api";

describe("Sidebar", () => {
  it("collapses to icons but keeps every entry reachable by name", async () => {
    useUiStore.setState({ sidebarCollapsed: false });
    renderWithApp(<Sidebar active="agenda" onSelect={() => {}} role="admin" />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(screen.getByRole("button", { name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    useUiStore.setState({ sidebarCollapsed: false });
  });

  it("marks the active view", () => {
    renderWithApp(<Sidebar active="floor" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Floor plan" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Agenda" })).not.toHaveAttribute("aria-current");
  });
});

describe("MobileNav", () => {
  it("selects a view and closes the drawer", async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    renderWithApp(
      <MobileNav open onOpenChange={onOpenChange} active="agenda" onSelect={onSelect} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Waitlist" }));
    expect(onSelect).toHaveBeenCalledWith("waitlist");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("names the drawer after the product", async () => {
    renderWithApp(<MobileNav open onOpenChange={() => {}} active="agenda" onSelect={() => {}} />);
    expect(await screen.findByRole("dialog", { name: "OpenCovers" })).toBeInTheDocument();
  });
});
