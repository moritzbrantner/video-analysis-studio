import { useState } from "react";
import { RefreshIcon } from "../shared/icons";
import { classNames, hexToRgba } from "../shared/utils";
import {
  formatHotkeyBinding,
  hotkeyActions,
  hotkeyBindingConflicts,
  hotkeyBindingFromKeyboardEvent,
} from "../workflow-editor/hotkeys";
import { portTypeColor } from "../workflow-editor/portColors";
import { formatPortType, portTypes } from "../workflow-editor/portTypes";
import type {
  HotkeyActionId,
  HotkeyBinding,
  HotkeyBindings,
  PortType,
  PortTypeColors,
} from "../workflow-editor/types";

export function SettingsPage({
  portTypeColors,
  onPortTypeColorChange,
  onResetPortTypeColors,
  hotkeyBindings,
  onHotkeyChange,
  onResetHotkeys,
}: {
  portTypeColors: PortTypeColors;
  onPortTypeColorChange: (type: PortType, color: string) => void;
  onResetPortTypeColors: () => void;
  hotkeyBindings: HotkeyBindings;
  onHotkeyChange: (actionId: HotkeyActionId, binding: HotkeyBinding) => void;
  onResetHotkeys: () => void;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <HotkeySettings bindings={hotkeyBindings} onChange={onHotkeyChange} onReset={onResetHotkeys} />
        <PortTypeColorSettings
          colors={portTypeColors}
          onChange={onPortTypeColorChange}
          onReset={onResetPortTypeColors}
        />
      </section>
      <aside className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-950">Active Hotkeys</h2>
        <div className="mt-3 space-y-2">
          {hotkeyActions.map((action) => (
            <div
              key={action.id}
              className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs"
            >
              <span className="min-w-0 truncate font-medium text-zinc-900">{action.label}</span>
              <kbd className="shrink-0 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-[11px] text-zinc-700">
                {formatHotkeyBinding(hotkeyBindings[action.id])}
              </kbd>
            </div>
          ))}
        </div>
        <div className="mt-5 border-t border-zinc-200 pt-4">
          <h2 className="text-sm font-semibold text-zinc-950">Type Preview</h2>
          <div className="mt-3 space-y-2">
            {portTypes.slice(0, 8).map((type) => {
              const color = portTypeColor(type, portTypeColors);
              return (
                <div
                  key={type}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                  style={{ borderColor: hexToRgba(color, 0.32), backgroundColor: hexToRgba(color, 0.08) }}
                >
                  <span className="font-medium text-zinc-900">{formatPortType(type)}</span>
                  <span className="h-4 w-4 rounded-full border border-white shadow-sm" style={{ backgroundColor: color }} />
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </section>
  );
}

function HotkeySettings({
  bindings,
  onChange,
  onReset,
}: {
  bindings: HotkeyBindings;
  onChange: (actionId: HotkeyActionId, binding: HotkeyBinding) => void;
  onReset: () => void;
}) {
  const [recordingActionId, setRecordingActionId] = useState<HotkeyActionId | null>(null);
  const conflicts = hotkeyBindingConflicts(bindings);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase text-zinc-500">Hotkeys</div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
          onClick={onReset}
          title="Reset hotkeys"
          aria-label="Reset hotkeys"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 overflow-hidden rounded-md border border-zinc-200">
        {hotkeyActions.map((action, index) => {
          const recording = recordingActionId === action.id;
          const conflict = conflicts.has(action.id);
          return (
            <div
              key={action.id}
              className={classNames(
                "grid min-h-12 grid-cols-[minmax(0,1fr)_128px] items-center gap-3 px-3 py-2 text-xs",
                index > 0 && "border-t border-zinc-200",
                conflict ? "bg-amber-50" : "bg-white",
              )}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-zinc-900">{action.label}</div>
                <div className={classNames("mt-0.5 text-[11px]", conflict ? "text-amber-700" : "text-zinc-500")}>
                  {conflict ? "Conflict" : action.scope}
                </div>
              </div>
              <button
                type="button"
                className={classNames(
                  "inline-flex h-8 items-center justify-center rounded-md border px-2 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2",
                  recording
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-300 bg-zinc-50 text-zinc-800 hover:bg-white",
                )}
                onClick={() => setRecordingActionId(action.id)}
                onBlur={() => {
                  if (recording) {
                    setRecordingActionId(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (!recording) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    setRecordingActionId(null);
                    return;
                  }
                  const binding = hotkeyBindingFromKeyboardEvent(event);
                  if (!binding) {
                    return;
                  }
                  onChange(action.id, binding);
                  setRecordingActionId(null);
                }}
                title={`${action.label} hotkey`}
                aria-label={`${action.label} hotkey`}
              >
                {recording ? "Recording" : formatHotkeyBinding(bindings[action.id])}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PortTypeColorSettings({
  colors,
  onChange,
  onReset,
}: {
  colors: PortTypeColors;
  onChange: (type: PortType, color: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-4 border-t border-zinc-200 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase text-zinc-500">Type Colors</div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
          onClick={onReset}
          title="Reset type colors"
          aria-label="Reset type colors"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 max-h-56 space-y-1 overflow-auto pr-1">
        {portTypes.map((type) => {
          const color = colors[type];
          return (
            <label
              key={type}
              className="flex h-9 items-center gap-2 rounded-md border px-2 text-xs"
              style={{
                borderColor: hexToRgba(color, 0.28),
                backgroundColor: hexToRgba(color, 0.08),
              }}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-white shadow-sm"
                style={{ backgroundColor: color }}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{formatPortType(type)}</span>
              <input
                type="color"
                className="h-7 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                value={color}
                onChange={(event) => onChange(type, event.target.value)}
                title={`${formatPortType(type)} color`}
                aria-label={`${formatPortType(type)} color`}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
