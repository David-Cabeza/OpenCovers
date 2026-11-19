import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Text written in a component instead of the catalog is not translated, so it stays English on a Spanish screen.
// The audit script finds what is almost always that; a line that is right as it is ends with `// i18n-ok`.
describe("text for people", () => {
  it("comes from the catalog, not from the components", () => {
    let out = "";
    try {
      execFileSync("node", [resolve(__dirname, "../../scripts/i18n-audit.mjs")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      out = (error as { stdout?: string }).stdout ?? String(error);
    }
    expect(out.trim(), "text written in English in the source (move it to the catalog, or end the line with // i18n-ok):\n" + out).toBe("");
  });
});
