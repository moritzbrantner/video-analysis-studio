import { spawn } from "node:child_process";

import { readOrCreateDevApiToken, readRuntimeConfig, uiDevUrl } from "./runtime-config.mjs";

const config = readRuntimeConfig();
const apiToken = readOrCreateDevApiToken();
const beforeDevCommand = [
  "bun",
  "run",
  "--cwd",
  "../ui",
  "dev",
  "--",
  "--host",
  config.ui.host,
  "--port",
  String(config.ui.devPort),
  "--strictPort",
].join(" ");

const tauriConfig = JSON.stringify({
  build: {
    beforeDevCommand,
    devUrl: uiDevUrl(config),
  },
});

const desktopProcess = spawn(
  "bun",
  [
    "run",
    "--cwd",
    "apps/desktop",
    "tauri",
    "dev",
    "--config",
    tauriConfig,
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    cwd: process.cwd(),
    env: {
      ...process.env,
      STUDIO_API_TOKEN: apiToken,
      VITE_STUDIO_API_TOKEN: apiToken,
    },
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (desktopProcess.exitCode === null) {
      desktopProcess.kill(signal);
    }
  });
}

desktopProcess.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
    return;
  }
  process.exit(code ?? 0);
});
