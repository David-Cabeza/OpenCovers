import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FLOOR_ITEM_TYPES } from "@/lib/floor-item-types";
import { FloorItemShape } from "./floor-item-shape";

const markup = (type: string) => render(<FloorItemShape type={type} />).container.innerHTML;

describe("FloorItemShape", () => {
  const generic = markup("something-unknown");

  it("draws its own shape for every type in the editor palette", () => {
    for (const type of Object.keys(FLOOR_ITEM_TYPES)) {
      expect(markup(type), type).not.toBe(generic);
    }
  });

  it("falls back to a plain block for a type this app does not know", () => {
    expect(generic).toContain("<svg");
  });
});
