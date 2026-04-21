import type { TimelineScene } from "../types";
import { EmptyState, Panel } from "../shared/primitives";
import {
  formatSeconds,
  sceneEndFrame,
  sceneEndSeconds,
  sceneIndex,
  sceneStartFrame,
  sceneStartSeconds,
} from "../shared/utils";

export function SplitPlanTable({
  scenes,
  videoName = "video",
  template = "$VIDEO_NAME-Scene-$SCENE_NUMBER.mp4",
}: {
  scenes: TimelineScene[];
  videoName?: string;
  template?: string;
}) {
  return (
    <Panel title="Split Plan" description={`${scenes.length} output clips`}>
      {scenes.length === 0 ? (
        <EmptyState>No scene clips</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Output</th>
                <th className="px-3 py-2 font-medium">Start</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Frames</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {scenes.map((scene, index) => {
                const number = sceneIndex(scene, index + 1);
                const start = sceneStartSeconds(scene);
                const end = sceneEndSeconds(scene);
                return (
                  <tr key={`${sceneStartFrame(scene)}-${sceneEndFrame(scene)}-${index}`}>
                    <td className="px-3 py-2 font-medium text-zinc-950">
                      {formatOutputName(template, videoName, number, scene)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-zinc-700">{formatSeconds(start)}</td>
                    <td className="px-3 py-2 tabular-nums text-zinc-700">
                      {formatSeconds(end - start)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-zinc-700">
                      {sceneStartFrame(scene)}-{sceneEndFrame(scene)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function formatOutputName(
  template: string,
  videoName: string,
  sceneNumber: number,
  scene: TimelineScene,
): string {
  const digits = Math.max(3, String(sceneNumber).length);
  return template
    .split("$VIDEO_NAME")
    .join(videoName)
    .split("$SCENE_NUMBER")
    .join(String(sceneNumber).padStart(digits, "0"))
    .split("$START_FRAME")
    .join(String(sceneStartFrame(scene)))
    .split("$END_FRAME")
    .join(String(sceneEndFrame(scene)));
}
