import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const runtimeConfigPath = path.join(repoRoot, "config", "runtime.json");
const defaultDevApiTokenPath = path.join(repoRoot, "studio-data", "dev-api-token");

export function readRuntimeConfig() {
  const raw = JSON.parse(readFileSync(runtimeConfigPath, "utf8"));
  validateRuntimeConfig(raw);
  return raw;
}

export function studioApiBaseUrl(config = readRuntimeConfig()) {
  return `http://${config.api.host}:${config.api.port}`;
}

export function uiDevUrl(config = readRuntimeConfig()) {
  return `http://${resolveLoopbackHost(config.ui.host)}:${config.ui.devPort}`;
}

export function uiBaseUrl(config = readRuntimeConfig()) {
  return `http://${config.ui.e2eHost}:${config.ui.e2ePort}`;
}

export function runtimeConfigFilePath() {
  return runtimeConfigPath;
}

export function devApiTokenFilePath() {
  return defaultDevApiTokenPath;
}

export function readOrCreateDevApiToken(tokenPath = defaultDevApiTokenPath) {
  const envToken = process.env.STUDIO_API_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }
  if (existsSync(tokenPath)) {
    const token = readFileSync(tokenPath, "utf8").trim();
    if (token) {
      return token;
    }
  }
  mkdirSync(path.dirname(tokenPath), { recursive: true });
  const token = `${randomUUID()}${randomUUID()}`;
  writeFileSync(tokenPath, `${token}\n`);
  return token;
}

function validateRuntimeConfig(value) {
  assertRecord(value, "runtime config");
  assertRecord(value.api, "runtime config api");
  assertRecord(value.ui, "runtime config ui");
  assertString(value.api.host, "runtime config api.host");
  assertPort(value.api.port, "runtime config api.port");
  assertString(value.ui.host, "runtime config ui.host");
  assertPort(value.ui.devPort, "runtime config ui.devPort");
  assertString(value.ui.e2eHost, "runtime config ui.e2eHost");
  assertPort(value.ui.e2ePort, "runtime config ui.e2ePort");
}

function assertRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertPort(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }
}

function resolveLoopbackHost(host) {
  if (host === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (host === "::" || host === "[::]") {
    return "[::1]";
  }
  return host;
}
