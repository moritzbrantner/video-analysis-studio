import type React from "react";
import { isRecord } from "../shared/utils";
import { hotkeyBindingsStorageKey } from "./constants";
import type { HotkeyActionId, HotkeyBinding, HotkeyBindings } from "./types";

export const hotkeyActions: Array<{
  id: HotkeyActionId;
  label: string;
  scope: string;
}> = [
  { id: "copySelection", label: "Copy selection", scope: "Workflow" },
  { id: "pasteSelection", label: "Paste selection", scope: "Workflow" },
  { id: "deleteSelection", label: "Delete selection", scope: "Workflow" },
  { id: "saveWorkflowVersion", label: "Save version", scope: "Workflow" },
  { id: "groupSelection", label: "Group selection", scope: "Workflow" },
  { id: "ungroupSelection", label: "Ungroup selection", scope: "Workflow" },
];

export const defaultHotkeyBindings: HotkeyBindings = {
  copySelection: { key: "C", ctrl: true },
  pasteSelection: { key: "V", ctrl: true },
  deleteSelection: { key: "Delete" },
  saveWorkflowVersion: { key: "S", ctrl: true },
  groupSelection: { key: "G", ctrl: true, shift: true },
  ungroupSelection: { key: "G", ctrl: true, alt: true },
};

export function matchesHotkeyBinding(event: KeyboardEvent, binding: HotkeyBinding): boolean {
  return (
    normalizeHotkeyKey(event.key) === binding.key &&
    event.ctrlKey === Boolean(binding.ctrl) &&
    event.shiftKey === Boolean(binding.shift) &&
    event.altKey === Boolean(binding.alt) &&
    event.metaKey === Boolean(binding.meta)
  );
}

export function hotkeyBindingFromKeyboardEvent(event: KeyboardEvent | React.KeyboardEvent<HTMLElement>): HotkeyBinding | null {
  const key = normalizeHotkeyKey(event.key);
  if (!key || ["Control", "Shift", "Alt", "Meta"].includes(key)) {
    return null;
  }
  return normalizeHotkeyBinding({
    key,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  });
}

function normalizeHotkeyKey(key: string): string {
  if (key === " ") {
    return "Space";
  }
  if (key.length === 1) {
    return key.toUpperCase();
  }
  switch (key) {
    case "Esc":
      return "Escape";
    case "Del":
      return "Delete";
    default:
      return key;
  }
}

function normalizeHotkeyBinding(value: unknown): HotkeyBinding | null {
  if (!isRecord(value) || typeof value.key !== "string") {
    return null;
  }
  const key = normalizeHotkeyKey(value.key.trim());
  if (!key) {
    return null;
  }
  return {
    key,
    ctrl: value.ctrl === true || undefined,
    shift: value.shift === true || undefined,
    alt: value.alt === true || undefined,
    meta: value.meta === true || undefined,
  };
}

export function formatHotkeyBinding(binding: HotkeyBinding): string {
  return [
    binding.ctrl ? "Ctrl" : null,
    binding.meta ? "Meta" : null,
    binding.alt ? "Alt" : null,
    binding.shift ? "Shift" : null,
    formatHotkeyKey(binding.key),
  ]
    .filter((part): part is string => Boolean(part))
    .join("+");
}

function formatHotkeyKey(key: string): string {
  switch (key) {
    case " ":
      return "Space";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    default:
      return key;
  }
}

function hotkeyBindingSignature(binding: HotkeyBinding): string {
  return [
    binding.ctrl ? "ctrl" : "",
    binding.meta ? "meta" : "",
    binding.alt ? "alt" : "",
    binding.shift ? "shift" : "",
    binding.key.toLowerCase(),
  ].join("+");
}

export function hotkeyBindingConflicts(bindings: HotkeyBindings): Set<HotkeyActionId> {
  const actionIdsByBinding = new Map<string, HotkeyActionId[]>();
  for (const action of hotkeyActions) {
    const signature = hotkeyBindingSignature(bindings[action.id]);
    actionIdsByBinding.set(signature, [...(actionIdsByBinding.get(signature) ?? []), action.id]);
  }
  const conflicts = new Set<HotkeyActionId>();
  for (const actionIds of actionIdsByBinding.values()) {
    if (actionIds.length > 1) {
      actionIds.forEach((actionId) => conflicts.add(actionId));
    }
  }
  return conflicts;
}

export function shouldIgnoreHotkeyEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) {
    return true;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function loadHotkeyBindings(): HotkeyBindings {
  if (typeof window === "undefined") {
    return defaultHotkeyBindings;
  }

  try {
    const raw = window.localStorage.getItem(hotkeyBindingsStorageKey);
    if (!raw) {
      return defaultHotkeyBindings;
    }
    return normalizeHotkeyBindings(JSON.parse(raw));
  } catch {
    return defaultHotkeyBindings;
  }
}

export function persistHotkeyBindings(bindings: HotkeyBindings) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(hotkeyBindingsStorageKey, JSON.stringify(normalizeHotkeyBindings(bindings)));
}

function normalizeHotkeyBindings(value: unknown): HotkeyBindings {
  const record = isRecord(value) ? value : {};
  return hotkeyActions.reduce<HotkeyBindings>(
    (bindings, action) => {
      const binding = normalizeHotkeyBinding(record[action.id]);
      bindings[action.id] = binding ?? defaultHotkeyBindings[action.id];
      return bindings;
    },
    { ...defaultHotkeyBindings },
  );
}
