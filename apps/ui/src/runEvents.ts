import type { RunEvent } from "./api/client";

export function appendRunEvent(events: RunEvent[], nextEvent: RunEvent): RunEvent[] {
  const previousEvent = events[events.length - 1];
  if (previousEvent && shouldReplaceRunEvent(previousEvent, nextEvent)) {
    return [...events.slice(0, -1), nextEvent];
  }
  return [...events, nextEvent];
}

export function normalizeRunEvents(events: RunEvent[]): RunEvent[] {
  return events.reduce<RunEvent[]>((current, event) => appendRunEvent(current, event), []);
}

function shouldReplaceRunEvent(previousEvent: RunEvent, nextEvent: RunEvent): boolean {
  return (
    typeof previousEvent.progress === "number" &&
    typeof nextEvent.progress === "number" &&
    previousEvent.run_id === nextEvent.run_id &&
    previousEvent.status === nextEvent.status &&
    previousEvent.message === nextEvent.message &&
    (previousEvent.node ?? null) === (nextEvent.node ?? null) &&
    (previousEvent.phase ?? null) === (nextEvent.phase ?? null)
  );
}
