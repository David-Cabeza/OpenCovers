import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        roadmap: path.resolve(import.meta.dirname, "hoja-de-ruta/index.html"),
        brigada: path.resolve(import.meta.dirname, "brigada/index.html"),
      },
    },
  },
  server: {
    port: 5174,
  },
});
