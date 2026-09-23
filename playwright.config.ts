import { defineConfig, devices } from "@playwright/test";

// E2E runs against a seeded database (`pnpm db:setup`) and a production build (`pnpm build`).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm start --port 3100",
        url: "http://localhost:3100/login",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
