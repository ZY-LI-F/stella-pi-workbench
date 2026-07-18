import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.live.ts",
  timeout: 1_500_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
