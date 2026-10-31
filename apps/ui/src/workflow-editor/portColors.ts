import React from "react";
import { isRecord, mixHexColors, normalizeHexColor } from "../shared/utils";
import { portTypeColorsStorageKey } from "./constants";
import { PortTypeColorContext } from "./contexts";
import { defaultPortTypeColors, portTypes } from "./portTypes";
import type { PortType, PortTypeColors, PortTypeColorStyle } from "./types";

export function usePortTypeColors(): PortTypeColors {
  return React.useContext(PortTypeColorContext);
}

export function portTypeColor(type: PortType, colors: PortTypeColors): string {
  return colors[type] ?? defaultPortTypeColors[type];
}

export function portTypeColorVar(type: PortType): string {
  return `var(${portTypeColorVariableName(type)}, ${defaultPortTypeColors[type]})`;
}

function portTypeColorVariableName(type: PortType): `--workflow-port-color-${PortType}` {
  return `--workflow-port-color-${type}`;
}

export function portTypeColorsStyle(colors: PortTypeColors): PortTypeColorStyle {
  return portTypes.reduce((style, type) => {
    style[portTypeColorVariableName(type)] = portTypeColor(type, colors);
    return style;
  }, {} as PortTypeColorStyle);
}

export function portTypeBadgeTextColor(color: string): string {
  return mixHexColors(normalizeHexColor(color) ?? "#52525b", "#18181b", 0.35);
}

export function loadPortTypeColors(): PortTypeColors {
  if (typeof window === "undefined") {
    return defaultPortTypeColors;
  }

  try {
    const raw = window.localStorage.getItem(portTypeColorsStorageKey);
    if (!raw) {
      return defaultPortTypeColors;
    }
    return normalizePortTypeColors(JSON.parse(raw));
  } catch {
    return defaultPortTypeColors;
  }
}

export function persistPortTypeColors(colors: PortTypeColors) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(portTypeColorsStorageKey, JSON.stringify(normalizePortTypeColors(colors)));
}

function normalizePortTypeColors(value: unknown): PortTypeColors {
  const record = isRecord(value) ? value : {};
  return portTypes.reduce<PortTypeColors>((colors, type) => {
    const color = record[type];
    colors[type] = typeof color === "string" ? normalizeHexColor(color) ?? defaultPortTypeColors[type] : defaultPortTypeColors[type];
    return colors;
  }, { ...defaultPortTypeColors });
}
