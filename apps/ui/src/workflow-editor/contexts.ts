import React from "react";
import { defaultPortTypeColors } from "./portTypes";
import type {
  PortTypeColors,
  WorkflowFocusTarget,
  WorkflowOutputConnectorContextValue,
} from "./types";

export const PortTypeColorContext = React.createContext<PortTypeColors>(defaultPortTypeColors);

export const WorkflowOutputConnectorContext = React.createContext<WorkflowOutputConnectorContextValue>({
  onOutputDoubleClick: () => undefined,
});

export const WorkflowFocusContext = React.createContext<WorkflowFocusTarget | null>(null);
