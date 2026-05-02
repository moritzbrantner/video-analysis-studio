export type AppPage = "analysis" | "runs" | "workflow" | "components" | "data-sources" | "types" | "settings";

export interface AppLocation {
  page: AppPage;
  workflowId: string | null;
  typeId: string | null;
}

export function appLocationFromPath(pathname: string): AppLocation {
  const segments = pathname.split("/").filter(Boolean);
  const [pageSegment, workflowSegment] = segments;
  if (pageSegment === "workflow" || pageSegment === "workflows") {
    return {
      page: "workflow",
      workflowId: decodePathSegment(workflowSegment),
      typeId: null,
    };
  }
  if (pageSegment === "run" || pageSegment === "runs") {
    return {
      page: "runs",
      workflowId: decodePathSegment(workflowSegment),
      typeId: null,
    };
  }
  if (pageSegment === "data-sources" || pageSegment === "datasources") {
    return { page: "data-sources", workflowId: null, typeId: null };
  }
  if (pageSegment === "components" || pageSegment === "component-library") {
    return { page: "components", workflowId: null, typeId: null };
  }
  if (pageSegment === "types" || pageSegment === "type-library") {
    return { page: "types", workflowId: null, typeId: decodePathSegment(workflowSegment) };
  }
  if (pageSegment === "settings") {
    return { page: "settings", workflowId: null, typeId: null };
  }
  return { page: "analysis", workflowId: null, typeId: null };
}

export function pathForAppPage(page: AppPage, workflowId?: string | null): string {
  switch (page) {
    case "workflow":
      return workflowId ? `/workflow/${encodeURIComponent(workflowId)}` : "/workflow";
    case "runs":
      return workflowId ? `/runs/${encodeURIComponent(workflowId)}` : "/runs";
    case "components":
      return "/components";
    case "data-sources":
      return "/data-sources";
    case "types":
      return "/types";
    case "settings":
      return "/settings";
    case "analysis":
      return "/";
  }
}

export function pathForTypeDefinitionPage(typeId?: string | null): string {
  return typeId ? `/types/${encodeURIComponent(typeId)}` : "/types";
}

function decodePathSegment(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
