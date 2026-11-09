import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          VENUE_JURISDICTION: "",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
