import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// No index.html: the API writes the page per venue (ADR-0017 section 1) from the manifest of this build,
// and serves the files under /w/assets/. In development `vite build --watch` keeps dist/ current for the API.
export default defineConfig({
  base: "/w/",
  plugins: [react(), tailwindcss()],
  build: {
    manifest: true,
    rollupOptions: { input: "src/main.tsx" },
  },
  worker: { format: "es" },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
