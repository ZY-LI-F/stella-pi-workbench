import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  // Both specs launch a real Electron desktop process and Pi RPC child.
  // Serial workers prevent competing Electron cold starts on the same host.
  workers: 1,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
});
