import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgres://postgres:postgres@localhost:5432/opencovers_test",
    },
  },
});
