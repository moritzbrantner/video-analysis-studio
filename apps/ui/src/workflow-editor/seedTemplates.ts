import workflowSeedDefinitionsJson from "../workflow-seeds.json";
import type { WorkflowKindId } from "../run/types";
import type { WorkflowSeedDefinitionsFile, WorkflowSeedTemplate } from "./types";

export const exampleWorkflowSeeds: Array<{ kind: WorkflowKindId; name: string }> = [
  { kind: "youtube-video", name: "YouTube Video Quick Review" },
  { kind: "video-red-cars", name: "YouTube Red Cars Counter" },
  { kind: "video-red-cars", name: "YouTube Red Cars Only" },
  { kind: "youtube-collection", name: "YouTube Collection Spot Check" },
  { kind: "song-analysis", name: "Song Analysis Quick Match" },
  { kind: "subtitle-generation", name: "Subtitle SRT Starter" },
];

const workflowSeedDefinitions = workflowSeedDefinitionsJson as WorkflowSeedDefinitionsFile;

export const workflowStarterTemplates = workflowSeedDefinitions.starterTemplates as Record<
  WorkflowKindId,
  WorkflowSeedTemplate
>;

// Internal smoke-test fixtures for structural workflow graph coverage only.
const basicWorkflowTestTemplates = workflowSeedDefinitions.basicTestTemplates;

export const exampleWorkflowStarterTemplates = workflowSeedDefinitions.exampleStarterTemplates;
