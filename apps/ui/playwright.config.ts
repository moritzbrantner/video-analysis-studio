import { defineConfig, devices } from "@playwright/test";
import { readRuntimeConfig } from "../../scripts/runtime-config.mjs";

const runtimeConfig = readRuntimeConfig();
const e2eBaseUrl = `http://${runtimeConfig.ui.e2eHost}:${runtimeConfig.ui.e2ePort}`;
const e2eCommand = `bun run dev -- --host ${runtimeConfig.ui.e2eHost} --port ${runtimeConfig.ui.e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
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
