import { describe, expect, it } from "vitest";
import { checkDetails, withoutError } from "../src/validate";

describe("withoutError", () => {
  it("drops the error of the field that was edited and keeps the others", () => {
    const errors = checkDetails("", "no");
    expect(errors).toEqual({ name: "validate.name", contact: "validate.contact" });
    expect(withoutError(errors, "name")).toEqual({ contact: "validate.contact" });
    expect(withoutError(errors, "contact")).toEqual({ name: "validate.name" });
  });

  it("does not change the object it is given", () => {
    const errors = { name: "validate.name" } as const;
    withoutError(errors, "name");
    expect(errors).toEqual({ name: "validate.name" });
  });

  it("is harmless for a field with no error", () => {
    expect(withoutError({ time: "validate.time" } as { time?: string; name?: string }, "name")).toEqual({ time: "validate.time" });
    expect(withoutError({}, "name" as never)).toEqual({});
  });
});
