import { spawn } from "node:child_process";

import { readRuntimeConfig, studioApiBaseUrl } from "./runtime-config.mjs";

const config = readRuntimeConfig();
const apiBaseUrl = studioApiBaseUrl(config);
const healthUrl = `${apiBaseUrl}/api/system/dependencies`;

const apiProcess = spawn(
  "cargo",
  [
    "run",
    "-p",
    "studio-api",
    "--",
    "--host",
    config.api.host,
    "--port",
    String(config.api.port),
    "--data-dir",
    "./studio-data",
  ],
  {
    stdio: "inherit",
    cwd: process.cwd(),
  },
);

let uiProcess = null;
let shuttingDown = false;

apiProcess.on("exit", (code) => {
  if (!shuttingDown && uiProcess === null) {
    process.exit(code ?? 1);
  }
});

try {
  await waitForApi(healthUrl, apiProcess);
} catch (error) {
  shutdown();
  throw error;
}

uiProcess = spawn("bun", ["run", "--cwd", "apps/ui", "dev"], {
  stdio: "inherit",
  cwd: process.cwd(),
});

uiProcess.on("exit", (code) => {
  shutdown();
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal);
  });
}

function shutdown(signal = "SIGTERM") {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (uiProcess && uiProcess.exitCode === null) {
    uiProcess.kill(signal);
  }
  if (apiProcess.exitCode === null) {
    apiProcess.kill(signal);
  }
}

async function waitForApi(url, child) {
  const timeoutAt = Date.now() + 20_000;
  while (Date.now() < timeoutAt) {
    if (child.exitCode !== null) {
      throw new Error(`studio-api exited before becoming reachable at ${url}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting up.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for studio-api at ${url}`);
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
