import { defineConfig, devices } from "@playwright/test";
import { readRuntimeConfig } from "../../scripts/runtime-config.mjs";

const runtimeConfig = readRuntimeConfig();
const e2eBaseUrl = `http://${runtimeConfig.ui.e2eHost}:${runtimeConfig.ui.devPort}`;
const e2eCommand = `VITE_DISABLE_DEV_SEEDS=1 bun run dev -- --host ${runtimeConfig.ui.e2eHost} --port ${runtimeConfig.ui.devPort}`;

export default defineConfig({
  testDir: "./src",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: e2eCommand,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
