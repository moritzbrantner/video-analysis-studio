import type React from "react";
import type { Scene, SceneReport, Timestamp, TimelineScene } from "../types";

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function timestampSeconds(timestamp?: Timestamp | null): number | null {
  if (!timestamp) {
    return null;
  }
  if (typeof timestamp.seconds === "number") {
    return timestamp.seconds;
  }
  if (!timestamp.timebase || timestamp.timebase.den === 0) {
    return null;
  }
  return timestamp.pts * (timestamp.timebase.num / timestamp.timebase.den);
}

export function sceneStartSeconds(scene: TimelineScene): number {
  if (isSceneReport(scene)) {
    return scene.start_seconds;
  }
  return timestampSeconds(scene.start.timestamp) ?? 0;
}

export function sceneEndSeconds(scene: TimelineScene): number {
  if (isSceneReport(scene)) {
    return scene.end_seconds;
  }
  return timestampSeconds(scene.end.timestamp) ?? sceneStartSeconds(scene);
}

export function sceneStartFrame(scene: TimelineScene): number {
  return isSceneReport(scene) ? scene.start_frame : scene.start.frame_index;
}

export function sceneEndFrame(scene: TimelineScene): number {
  return isSceneReport(scene) ? scene.end_frame : scene.end.frame_index;
}

export function sceneIndex(scene: TimelineScene, fallback: number): number {
  return isSceneReport(scene) ? scene.index : fallback;
}

export function formatSeconds(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  const totalMs = Math.max(0, Math.round(value * 1000));
  const totalSeconds = Math.floor(totalMs / 1000);
  const ms = totalMs % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${ms
    .toString()
    .padStart(3, "0")}`;
}

export function formatNumber(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatBytes(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let next = Math.max(0, value);
  let unit = 0;
  while (next >= 1024 && unit < units.length - 1) {
    next /= 1024;
    unit += 1;
  }
  return `${next.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatScore(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  if (value >= 0 && value <= 1) {
    return `${Math.round(value * 100)}%`;
  }
  return value.toFixed(2);
}

export function ratioPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function isSceneReport(scene: Scene | SceneReport): scene is SceneReport {
  return "start_seconds" in scene;
}

export function formatWorkflowTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back to the legacy copy path below.
    }
  }
  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.className = "fixed left-[-9999px] top-0";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

export function fileDateStamp(isoDate: string): string {
  return isoDate.slice(0, 19).replace(/[:T]/g, "-");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function clampedFixedPosition(x: number, y: number, width: number, height: number): React.CSSProperties {
  if (typeof window === "undefined") {
    return { left: x, top: y };
  }
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}

function basename(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  return last.replace(/\.[^.]+$/, "") || "video";
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }
  return null;
}

export function hexToRgba(color: string, alpha: number): string {
  const normalized = normalizeHexColor(color) ?? "#52525b";
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function mixHexColors(color: string, target: string, amount: number): string {
  const sourceColor = normalizeHexColor(color) ?? "#52525b";
  const targetColor = normalizeHexColor(target) ?? "#18181b";
  const source = hexToRgb(sourceColor);
  const destination = hexToRgb(targetColor);
  const mixChannel = (sourceChannel: number, targetChannel: number) =>
    Math.round(sourceChannel + (targetChannel - sourceChannel) * amount);
  return rgbToHex(
    mixChannel(source.red, destination.red),
    mixChannel(source.green, destination.green),
    mixChannel(source.blue, destination.blue),
  );
}

function hexToRgb(color: string): { red: number; green: number; blue: number } {
  const normalized = normalizeHexColor(color) ?? "#52525b";
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(red: number, green: number, blue: number): string {
  const channelToHex = (channel: number) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0");
  return `#${channelToHex(red)}${channelToHex(green)}${channelToHex(blue)}`;
}

export function loadStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  const stored = window.localStorage.getItem(key);
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return fallback;
}

export function persistStoredBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, String(value));
}

export function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
