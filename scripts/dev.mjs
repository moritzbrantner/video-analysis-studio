import { spawn } from "node:child_process";

import { readRuntimeConfig, studioApiBaseUrl, uiDevUrl } from "./runtime-config.mjs";

const config = readRuntimeConfig();
const apiBaseUrl = studioApiBaseUrl(config);
const healthUrl = `${apiBaseUrl}/api/system/dependencies`;
const browserUrl = uiDevUrl(config);

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

let desktopProcess = null;
let shuttingDown = false;

apiProcess.on("exit", (code) => {
  if (!shuttingDown && desktopProcess === null) {
    process.exit(code ?? 1);
  }
});

try {
  await waitForApi(healthUrl, apiProcess);
} catch (error) {
  shutdown();
  throw error;
}

desktopProcess = spawn("bun", ["./scripts/desktop-dev.mjs"], {
  stdio: "inherit",
  cwd: process.cwd(),
});

try {
  await waitForUrl(browserUrl, desktopProcess, 60_000);
  openBrowser(browserUrl);
} catch (error) {
  shutdown();
  throw error;
}

desktopProcess.on("exit", (code) => {
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
  if (desktopProcess && desktopProcess.exitCode === null) {
    desktopProcess.kill(signal);
  }
  if (apiProcess.exitCode === null) {
    apiProcess.kill(signal);
  }
}

async function waitForApi(url, child) {
  return waitForUrl(url, child, 20_000);
}

async function waitForUrl(url, child, timeoutMs) {
  const timeoutAt = Date.now() + timeoutMs;
  while (Date.now() < timeoutAt) {
    if (child.exitCode !== null) {
      throw new Error(`process exited before becoming reachable at ${url}`);
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
  throw new Error(`Timed out waiting for ${url}`);
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function openBrowser(url) {
  const [command, args] = browserOpenCommand(url);
  const opener = spawn(command, args, {
    stdio: "ignore",
    detached: process.platform !== "win32",
  });

  opener.on("error", (error) => {
    console.warn(`Unable to open browser at ${url}: ${error.message}`);
  });

  opener.unref();
}

function browserOpenCommand(url) {
  if (process.platform === "darwin") {
    return ["open", [url]];
  }
  if (process.platform === "win32") {
    return ["cmd", ["/c", "start", "", url]];
  }
  return ["xdg-open", [url]];
}
