import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/stores/ui-store";
import { renderWithApp } from "@/test/mock-api";
import { FloorCanvas } from "./floor-canvas";
import { FloorSkinToggle } from "./floor-skin-toggle";
import { FLOOR_SKINS, isFloorSkinId } from "./skins";

const TABLE = { id: "t1", name: "T1", seats: 2, posX: 0, posY: 0 };

describe("floor skins", () => {
  afterEach(() => useUiStore.setState({ floorSkin: "plano" }));

  it("starts on the plan look and switches to the ambiance look", async () => {
    const user = userEvent.setup();
    renderWithApp(
      <>
        <FloorSkinToggle />
        <FloorCanvas tables={[TABLE]} mode="view" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Plan" })).toHaveAttribute("aria-pressed", "true");
    const planFloor = screen.getByTestId("floor-canvas").getAttribute("style");

    await user.click(screen.getByRole("button", { name: "Ambiance" }));
    expect(screen.getByRole("button", { name: "Ambiance" })).toHaveAttribute("aria-pressed", "true");
    expect(useUiStore.getState().floorSkin).toBe("ambiente");
    expect(screen.getByTestId("floor-canvas").getAttribute("style")).not.toBe(planFloor);
  });

  it("keeps the dot grid in edit mode on every look", () => {
    for (const skin of Object.values(FLOOR_SKINS)) {
      expect(String(skin.floor("edit").backgroundImage), skin.id).toContain("radial-gradient");
    }
  });

  it("recognises only skins that exist", () => {
    expect(isFloorSkinId("ambiente")).toBe(true);
    expect(isFloorSkinId("neon")).toBe(false);
    expect(isFloorSkinId(undefined)).toBe(false);
  });
});
