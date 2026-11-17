import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/v1": "http://localhost:3000",
      // The booking widget, in local development only (ADR-0017 section 1). Production serves it from WIDGET_ADDRESS.
      "^/w/": "http://localhost:3000",
    },
  },
});
