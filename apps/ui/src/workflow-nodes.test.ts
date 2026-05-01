import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { WorkflowTypeSpec } from "./api/client";
import { workflowTypesAssignable } from "./workflowTypeSpec";

type PortType =
  | "run_request"
  | "run_config"
  | "template_string"
  | "string_value"
  | "number_value"
  | "boolean_value"
  | "array_value"
  | "youtube_url"
  | "youtube_collection_url"
  | "video_file"
  | "image_file"
  | "audio_file"
  | "media_file"
  | "transcript"
  | "subtitle_file"
  | "collection_manifest"
  | "collection_item"
  | "collection_report"
  | "collection_table"
  | "video_metadata"
  | "video_frame"
  | "audio_frame"
  | "audio_wav"
  | "song_fingerprint"
  | "song_match"
  | "music_feature"
  | "scene_result"
  | "video_observation"
  | "model_request"
  | "model_prediction"
  | "transcript_segment"
  | "audio_event"
  | "text_event"
  | "http_request"
  | "http_response"
  | "object_value"
  | "data_value"
  | "data_record"
  | "data_bucket"
  | "json_report"
  | "dashboard_view"
  | "song_catalog";

interface FlowPortFixture {
  id: string;
  label: string;
  type: PortType;
  optional?: boolean;
  stream?: boolean;
  valueType?: WorkflowTypeSpec;
}

interface WorkflowNodeFixture {
  arrayName: string;
  id: string;
  x: number;
  y: number;
  title: string;
  packageName: string;
  description: string;
  category?: string;
  tone: string;
  inputs: FlowPortFixture[];
  outputs: FlowPortFixture[];
  tags?: string[];
  adapterNode?: boolean;
}

interface WorkflowEdgeFixture {
  source: string;
  sourcePortId: string;
  target: string;
  targetPortId: string;
}

interface WorkflowSeedFixture {
  key: string;
  nodes: Array<{ id: string; x: number; y: number }>;
  edges: WorkflowEdgeFixture[];
}

interface WorkflowSeedDefinitionsFixture {
  starterTemplates: Record<string, Omit<WorkflowSeedFixture, "key">>;
  basicTestTemplates: Record<string, Omit<WorkflowSeedFixture, "key">>;
  exampleStarterTemplates: Record<string, Omit<WorkflowSeedFixture, "key">>;
}

const workflowNodeArrayNames = [
  "initialWorkflowNodes",
  "dashboardWorkflowNodes",
  "generatorWorkflowNodes",
  "adapterWorkflowNodes",
  "streamWorkflowNodes",
  "httpWorkflowNodes",
  "controlFlowWorkflowNodes",
] as const;

const packageOnlyWorkflowNodeIds = new Set([
  "audio-voice-analysis-workflow",
  "image-person-edit-workflow",
]);

const allowedCategories = new Set([
  "Application",
  "Input",
  "API",
  "Pipeline",
  "Ingest",
  "Detection",
  "Models",
  "Audio",
  "Text",
  "Data",
  "Report",
  "Dashboard",
  "Output",
  "Generator",
  "Control Flow",
  "Reusable",
]);

const allowedTones = new Set([
  "sky",
  "rose",
  "amber",
  "emerald",
  "violet",
  "cyan",
  "indigo",
  "fuchsia",
  "slate",
  "zinc",
]);

const workflowSource = readFileSync(join(import.meta.dir, "main.tsx"), "utf8");
const workflowCatalogJsonSource = readFileSync(
  join(import.meta.dir, "../../../crates/studio-core/src/workflow_catalog.json"),
  "utf8",
);
const workflowCatalogDefinition = JSON.parse(workflowCatalogJsonSource) as {
  version: number;
  nodes: Array<{ id: string }>;
};
const workflowSeedJsonSource = readFileSync(join(import.meta.dir, "workflow-seeds.json"), "utf8");
const workflowSeedDefinitions = JSON.parse(workflowSeedJsonSource) as WorkflowSeedDefinitionsFixture;
const sourceFile = ts.createSourceFile("main.tsx", workflowSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const topLevelConstants = collectTopLevelConstants(sourceFile);
const portTypes = new Set(readStringArrayConstant("portTypes") as PortType[]);
const streamBridgePortDescriptors = readStreamBridgePortDescriptors();

const nodesByArrayName = new Map(
  workflowNodeArrayNames.map((arrayName) => [arrayName, readWorkflowNodeArray(arrayName)]),
);
const workflowNodes = workflowNodeArrayNames.flatMap((arrayName) => nodesByArrayName.get(arrayName) ?? []);
const initialWorkflowNodes = nodesByArrayName.get("initialWorkflowNodes") ?? [];
const initialWorkflowEdges = readInitialWorkflowEdges();
const workflowStarterTemplates = withTemplateKeys(workflowSeedDefinitions.starterTemplates);
const basicWorkflowTestTemplates = withTemplateKeys(workflowSeedDefinitions.basicTestTemplates);
const exampleWorkflowStarterTemplates = withTemplateKeys(workflowSeedDefinitions.exampleStarterTemplates);

describe("workflow node catalog", () => {
  test("workflowNodeTemplates includes every node category array", () => {
    expect(readWorkflowTemplateArrayNames()).toEqual([...workflowNodeArrayNames]);
  });

  test("node IDs are unique across the catalog", () => {
    const ids = workflowNodes.map((node) => node.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  test("JSON workflow catalog nodes with TS templates exist in the TS template set", () => {
    const rustNodeIds = workflowCatalogDefinition.nodes
      .map((node) => node.id)
      .filter((id) => !packageOnlyWorkflowNodeIds.has(id));
    const tsNodeIds = new Set(workflowNodes.map((node) => node.id));
    expect(rustNodeIds.length).toBeGreaterThan(10);
    for (const id of rustNodeIds) {
      expect(tsNodeIds.has(id)).toBe(true);
    }
  });

  test("adapter templates are present with single input/output contracts", () => {
    const adapterNodes = workflowNodes.filter((node) => node.adapterNode === true);
    expect(adapterNodes.map((node) => node.id).sort()).toEqual(["data-adapter", "object-adapter"]);
    for (const node of adapterNodes) {
      expect(node.inputs).toHaveLength(1);
      expect(node.outputs).toHaveLength(1);
      expect(node.category).toBe("Data");
    }
  });

  test("workflow input surfaces are declared in both JSON and TS source nodes", () => {
    expect(workflowCatalogJsonSource).toContain("\"exposable_input\": true");
    expect(workflowCatalogJsonSource).toContain("\"input_surface\": \"source_url\"");
    expect(workflowCatalogJsonSource).toContain("\"input_surface\": \"collection_url\"");
    expect(workflowCatalogJsonSource).toContain("\"input_surface\": \"file\"");
    expect(workflowCatalogJsonSource).toContain("\"input_surface\": \"config\"");
    expect(workflowSource).toContain('inputSurface: "source_url"');
    expect(workflowSource).toContain('inputSurface: "collection_url"');
    expect(workflowSource).toContain('inputSurface: "file"');
    expect(workflowSource).toContain('inputSurface: "config"');
  });

  for (const node of workflowNodes) {
    test(`${node.arrayName}/${node.id} has valid node metadata and ports`, () => {
      expect(node.id).toMatch(/^[a-z0-9-]+$/);
      expect(node.title.trim()).not.toBe("");
      expect(node.packageName.trim()).not.toBe("");
      expect(node.description.trim().length).toBeGreaterThan(20);
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(allowedTones.has(node.tone)).toBe(true);
      expect(node.inputs.length + node.outputs.length).toBeGreaterThan(0);

      if (node.category !== undefined) {
        expect(allowedCategories.has(node.category)).toBe(true);
      }

      for (const direction of ["inputs", "outputs"] as const) {
        const ports = node[direction];
        const portKeys = ports.map((port) => `${port.id}|${port.type}|${port.stream === true ? "stream" : "value"}`);
        expect(portKeys).toHaveLength(new Set(portKeys).size);

        for (const port of ports) {
          expect(port.id).toMatch(/^[A-Za-z0-9_-]+$/);
          expect(port.label.trim()).not.toBe("");
          expect(portTypes.has(port.type)).toBe(true);
          expect(port.optional === undefined || typeof port.optional === "boolean").toBe(true);
          expect(port.stream === undefined || typeof port.stream === "boolean").toBe(true);
        }
      }

      if (node.tags) {
        expect(node.tags.every((tag) => tag.trim().length > 0)).toBe(true);
        expect(node.tags).toHaveLength(new Set(node.tags).size);
      }
    });
  }
});

describe("default workflow graph", () => {
  test("every default node participates in the seeded workflow", () => {
    const connectedNodeIds = new Set(initialWorkflowEdges.flatMap((edge) => [edge.source, edge.target]));
    expect(initialWorkflowNodes.filter((node) => !connectedNodeIds.has(node.id))).toEqual([]);
  });

  for (const edge of initialWorkflowEdges) {
    test(`${edge.source}:${edge.sourcePortId} -> ${edge.target}:${edge.targetPortId} references compatible ports`, () => {
      const sourceNode = initialWorkflowNodes.find((node) => node.id === edge.source);
      const targetNode = initialWorkflowNodes.find((node) => node.id === edge.target);
      expect(sourceNode).toBeDefined();
      expect(targetNode).toBeDefined();

      const sourcePort = sourceNode?.outputs.find((port) => port.id === edge.sourcePortId);
      const targetPort = targetNode?.inputs.find((port) => port.id === edge.targetPortId);
      expect(sourcePort).toBeDefined();
      expect(targetPort).toBeDefined();

      expect(sourcePort && targetPort ? portsCompatible(sourcePort, targetPort) : false).toBe(true);
    });
  }
});

describe("starter workflow templates", () => {
  test("default starters stay intentionally small", () => {
    expect(Object.keys(workflowStarterTemplates).sort()).toEqual([
      "image-similarity",
      "song-analysis",
      "subtitle-generation",
      "video-red-cars",
      "youtube-collection",
      "youtube-video",
    ]);
    for (const template of Object.values(workflowStarterTemplates)) {
      expect(template.nodes.length).toBeGreaterThanOrEqual(2);
      expect(template.nodes.length).toBeLessThanOrEqual(16);
    }
  });

  test("example starters stay intentionally small", () => {
    expect(Object.keys(exampleWorkflowStarterTemplates).sort()).toEqual([
      "Song Analysis Quick Match",
      "Subtitle SRT Starter",
      "YouTube Collection Spot Check",
      "YouTube Red Cars Counter",
      "YouTube Red Cars Only",
      "YouTube Video Quick Review",
    ]);
    for (const template of Object.values(exampleWorkflowStarterTemplates)) {
      expect(template.nodes.length).toBeGreaterThanOrEqual(2);
      expect(template.nodes.length).toBeLessThanOrEqual(6);
    }
  });

  for (const collection of [workflowStarterTemplates, exampleWorkflowStarterTemplates]) {
    for (const template of Object.values(collection)) {
      test(`${template.key} starter edges reference compatible catalog ports`, () => {
        const templateNodeIds = new Set(template.nodes.map((node) => node.id));
        expect(templateNodeIds.size).toBe(template.nodes.length);

        for (const edge of template.edges) {
          expect(templateNodeIds.has(edge.source)).toBe(true);
          expect(templateNodeIds.has(edge.target)).toBe(true);

          const sourceNode = workflowNodes.find((node) => node.id === edge.source);
          const targetNode = workflowNodes.find((node) => node.id === edge.target);
          expect(sourceNode).toBeDefined();
          expect(targetNode).toBeDefined();

          const sourcePort = sourceNode?.outputs.find((port) => port.id === edge.sourcePortId);
          const targetPort = targetNode?.inputs.find((port) => port.id === edge.targetPortId);
          expect(sourcePort).toBeDefined();
          expect(targetPort).toBeDefined();
          expect(sourcePort && targetPort ? portsCompatible(sourcePort, targetPort) : false).toBe(true);
        }
      });
    }
  }
});

describe("basic workflow test templates", () => {
  test("internal smoke fixtures stay intentionally tiny", () => {
    expect(Object.keys(basicWorkflowTestTemplates).sort()).toEqual([
      "Linear Video Ingest Smoke",
      "Song Match Fan-In Smoke",
    ]);
    for (const template of Object.values(basicWorkflowTestTemplates)) {
      expect(template.nodes.length).toBeGreaterThanOrEqual(2);
      expect(template.nodes.length).toBeLessThanOrEqual(3);
    }
  });

  for (const template of Object.values(basicWorkflowTestTemplates)) {
    test(`${template.key} fixture edges reference compatible catalog ports`, () => {
      const templateNodeIds = new Set(template.nodes.map((node) => node.id));
      expect(templateNodeIds.size).toBe(template.nodes.length);

      for (const edge of template.edges) {
        expect(templateNodeIds.has(edge.source)).toBe(true);
        expect(templateNodeIds.has(edge.target)).toBe(true);

        const sourceNode = workflowNodes.find((node) => node.id === edge.source);
        const targetNode = workflowNodes.find((node) => node.id === edge.target);
        expect(sourceNode).toBeDefined();
        expect(targetNode).toBeDefined();

        const sourcePort = sourceNode?.outputs.find((port) => port.id === edge.sourcePortId);
        const targetPort = targetNode?.inputs.find((port) => port.id === edge.targetPortId);
        expect(sourcePort).toBeDefined();
        expect(targetPort).toBeDefined();
        expect(sourcePort && targetPort ? portsCompatible(sourcePort, targetPort) : false).toBe(true);
      }
    });
  }
});

describe("structural port compatibility", () => {
  test("matching presentation kinds do not override structural mismatch", () => {
    expect(
      portsCompatible(
        {
          id: "source",
          label: "Source",
          type: "object_value",
          valueType: {
            type: "object",
            properties: [{ name: "id", value: { type: "string" }, required: true }],
            additional_properties: false,
          },
        },
        {
          id: "target",
          label: "Target",
          type: "object_value",
          valueType: {
            type: "object",
            properties: [
              { name: "id", value: { type: "string" }, required: true },
              { name: "title", value: { type: "string" }, required: true },
            ],
            additional_properties: false,
          },
        },
      ),
    ).toBe(false);
  });

  test("structurally compatible ports can connect even when presentation differs", () => {
    expect(
      portsCompatible(
        {
          id: "source",
          label: "YouTube URL",
          type: "youtube_url",
          valueType: { type: "string", semantic: "youtube_url" },
        },
        {
          id: "target",
          label: "Plain string",
          type: "string_value",
          valueType: { type: "string" },
        },
      ),
    ).toBe(true);
  });
});

function collectTopLevelConstants(file: ts.SourceFile): Map<string, ts.Expression> {
  const constants = new Map<string, ts.Expression>();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        constants.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return constants;
}

function readStringArrayConstant(name: string): string[] {
  const expression = requiredConstant(name);
  if (!ts.isArrayLiteralExpression(stripExpressionWrapper(expression))) {
    throw new Error(`${name} must be an array literal`);
  }
  return stripExpressionWrapper(expression).elements.map((element) => readString(element));
}

function readStreamBridgePortDescriptors(): Array<Record<string, string>> {
  const expression = stripExpressionWrapper(requiredConstant("streamBridgePortDescriptors"));
  if (!ts.isArrayLiteralExpression(expression)) {
    throw new Error("streamBridgePortDescriptors must be an array literal");
  }
  return expression.elements.map((element) => {
    const object = requireObjectLiteral(element, "stream bridge descriptor");
    return {
      id: readString(requiredProperty(object, "id")),
      label: readString(requiredProperty(object, "label")),
      type: readString(requiredProperty(object, "type")),
    };
  });
}

function readWorkflowNodeArray(name: string): WorkflowNodeFixture[] {
  const expression = stripExpressionWrapper(requiredConstant(name));
  if (!ts.isArrayLiteralExpression(expression)) {
    throw new Error(`${name} must be an array literal`);
  }
  return expression.elements.map((element) => readWorkflowNode(name, element));
}

function readWorkflowNode(arrayName: string, expression: ts.Expression): WorkflowNodeFixture {
  const call = requireCallExpression(expression, "workflowNode");
  const [idExpression, xExpression, yExpression, dataExpression] = call.arguments;
  const data = requireObjectLiteral(dataExpression, "workflow node data");

  return {
    arrayName,
    id: readString(idExpression),
    x: readNumber(xExpression),
    y: readNumber(yExpression),
    title: readString(requiredProperty(data, "title")),
    packageName: readString(requiredProperty(data, "packageName")),
    description: readString(requiredProperty(data, "description")),
    category: readOptionalString(optionalProperty(data, "category")),
    tone: readString(requiredProperty(data, "tone")),
    inputs: readPortArray(requiredProperty(data, "inputs")),
    outputs: readPortArray(requiredProperty(data, "outputs")),
    tags: readOptionalStringArray(optionalProperty(data, "tags")),
    adapterNode: readOptionalBoolean(optionalProperty(data, "adapterNode")),
  };
}

function readPortArray(expression: ts.Expression): FlowPortFixture[] {
  const unwrapped = stripExpressionWrapper(expression);
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.map((element) => readPort(element));
  }

  if (
    ts.isCallExpression(unwrapped) &&
    ts.isPropertyAccessExpression(unwrapped.expression) &&
    unwrapped.expression.name.text === "map" &&
    ts.isIdentifier(unwrapped.expression.expression) &&
    unwrapped.expression.expression.text === "streamBridgePortDescriptors"
  ) {
    const callback = unwrapped.arguments[0];
    if (!callback || !ts.isArrowFunction(callback) || !ts.isExpression(callback.body)) {
      throw new Error("stream bridge ports must use an expression-bodied map callback");
    }
    return streamBridgePortDescriptors.map((descriptor) => readPort(callback.body, descriptor));
  }

  throw new Error(`Unsupported port array expression: ${expression.getText(sourceFile)}`);
}

function readPort(expression: ts.Expression, context: Record<string, string> = {}): FlowPortFixture {
  const call = requireCallExpression(expression, "port");
  const [idExpression, labelExpression, typeExpression, optionsExpression] = call.arguments;
  const options = optionsExpression ? readPortOptions(optionsExpression) : {};
  return {
    id: readString(idExpression, context),
    label: readString(labelExpression, context),
    type: readString(typeExpression, context) as PortType,
    ...options,
  };
}

function readPortOptions(expression: ts.Expression): Pick<FlowPortFixture, "optional" | "stream"> {
  const object = requireObjectLiteral(expression, "port options");
  return {
    ...readOptionalBooleanProperty(object, "optional"),
    ...readOptionalBooleanProperty(object, "stream"),
  };
}

function readOptionalBooleanProperty(
  object: ts.ObjectLiteralExpression,
  propertyName: "optional" | "stream",
): Pick<FlowPortFixture, typeof propertyName> {
  const expression = optionalProperty(object, propertyName);
  if (!expression) {
    return {};
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return { [propertyName]: true };
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return { [propertyName]: false };
  }
  throw new Error(`${propertyName} must be a boolean literal`);
}

function readOptionalBoolean(expression: ts.Expression | undefined): boolean | undefined {
  if (!expression) {
    return undefined;
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  throw new Error("Expected boolean literal");
}

function readWorkflowTemplateArrayNames(): string[] {
  const expression = stripExpressionWrapper(requiredConstant("workflowNodeTemplates"));
  if (
    !ts.isCallExpression(expression) ||
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== "concat" ||
    !ts.isIdentifier(expression.expression.expression)
  ) {
    throw new Error("workflowNodeTemplates must concatenate node arrays");
  }
  return [expression.expression.expression.text, ...expression.arguments.map((argument) => readIdentifier(argument))];
}

function readInitialWorkflowEdges(): WorkflowEdgeFixture[] {
  const expression = stripExpressionWrapper(requiredConstant("initialWorkflowEdges"));
  if (!ts.isArrayLiteralExpression(expression)) {
    throw new Error("initialWorkflowEdges must be an array literal");
  }
  return expression.elements.map((element) => {
    const call = requireCallExpression(element, "workflowEdge");
    const [source, sourcePortId, target, targetPortId] = call.arguments;
    return {
      source: readString(source),
      sourcePortId: readString(sourcePortId),
      target: readString(target),
      targetPortId: readString(targetPortId),
    };
  });
}

function withTemplateKeys(
  templates: Record<string, Omit<WorkflowSeedFixture, "key">>,
): Record<string, WorkflowSeedFixture> {
  return Object.fromEntries(
    Object.entries(templates).map(([key, template]) => [key, { key, nodes: template.nodes, edges: template.edges }]),
  );
}

function readWorkflowSeedTemplates(name: string): Record<string, WorkflowSeedFixture> {
  const expression = stripExpressionWrapper(requiredConstant(name));
  const object = requireObjectLiteral(expression, `${name} object`);
  const entries = object.properties
    .filter((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property))
    .map((property) => {
      const key = propertyNameText(property.name);
      if (!key) {
        throw new Error(`Invalid key in ${name}`);
      }
      const value = requireObjectLiteral(property.initializer, `${name}.${key}`);
      const nodesExpression = stripExpressionWrapper(requiredProperty(value, "nodes"));
      const edgesExpression = stripExpressionWrapper(requiredProperty(value, "edges"));
      if (!ts.isArrayLiteralExpression(nodesExpression) || !ts.isArrayLiteralExpression(edgesExpression)) {
        throw new Error(`${name}.${key} must provide literal node and edge arrays`);
      }
      return [
        key,
        {
          key,
          nodes: nodesExpression.elements.map((element) => {
            const node = requireObjectLiteral(element, `${name}.${key}.node`);
            return {
              id: readString(requiredProperty(node, "id")),
              x: readNumber(requiredProperty(node, "x")),
              y: readNumber(requiredProperty(node, "y")),
            };
          }),
          edges: edgesExpression.elements.map((element) => {
            const edge = requireObjectLiteral(element, `${name}.${key}.edge`);
            return {
              source: readString(requiredProperty(edge, "source")),
              sourcePortId: readString(requiredProperty(edge, "sourcePortId")),
              target: readString(requiredProperty(edge, "target")),
              targetPortId: readString(requiredProperty(edge, "targetPortId")),
            };
          }),
        } satisfies WorkflowSeedFixture,
      ] as const;
    });
  return Object.fromEntries(entries);
}

function portsCompatible(sourcePort: FlowPortFixture, targetPort: FlowPortFixture): boolean {
  const streamConnection = sourcePort.stream === true || targetPort.stream === true;
  if (streamConnection) {
    return sourcePort.stream === true && targetPort.stream === true && workflowTypesAssignable(portValueType(sourcePort), portValueType(targetPort));
  }
  return workflowTypesAssignable(portValueType(sourcePort), portValueType(targetPort));
}

function portValueType(port: FlowPortFixture): WorkflowTypeSpec {
  return port.valueType ?? workflowTypeForPortType(port.type);
}

function workflowTypeForPortType(type: PortType): WorkflowTypeSpec {
  switch (type) {
    case "run_request":
      return { type: "object", properties: [], additional_properties: true, semantic: "run_request" };
    case "run_config":
      return { type: "object", properties: [], additional_properties: true, semantic: "run_config" };
    case "template_string":
      return { type: "string", semantic: "template_string" };
    case "string_value":
      return { type: "string" };
    case "number_value":
      return { type: "number" };
    case "boolean_value":
      return { type: "boolean" };
    case "array_value":
      return { type: "array", items: { type: "any" } };
    case "youtube_url":
      return { type: "string", semantic: "youtube_url" };
    case "youtube_collection_url":
      return { type: "string", semantic: "youtube_collection_url" };
    case "video_file":
      return { type: "binary", media_type: "video/*", semantic: "video_file" };
    case "image_file":
      return { type: "binary", media_type: "image/*", semantic: "image_file" };
    case "audio_file":
      return { type: "binary", media_type: "audio/*", semantic: "audio_file" };
    case "media_file":
      return { type: "binary", semantic: "media_file" };
    case "transcript":
      return { type: "object", properties: [], additional_properties: true, semantic: "transcript" };
    case "subtitle_file":
      return { type: "string", semantic: "subtitle_file" };
    case "collection_manifest":
      return { type: "object", properties: [], additional_properties: true, semantic: "collection_manifest" };
    case "collection_item":
      return { type: "object", properties: [], additional_properties: true, semantic: "collection_item" };
    case "collection_report":
      return { type: "object", properties: [], additional_properties: true, semantic: "collection_report" };
    case "collection_table":
      return { type: "object", properties: [], additional_properties: true, semantic: "collection_table" };
    case "video_metadata":
      return { type: "object", properties: [], additional_properties: true, semantic: "video_metadata" };
    case "video_frame":
      return { type: "binary", media_type: "image/*" };
    case "audio_frame":
      return { type: "binary", media_type: "audio/*", semantic: "audio_file" };
    case "audio_wav":
      return { type: "binary", media_type: "audio/wav", semantic: "audio_wav" };
    case "song_fingerprint":
      return { type: "object", properties: [], additional_properties: true, semantic: "song_fingerprint" };
    case "song_match":
      return { type: "object", properties: [], additional_properties: true, semantic: "song_match" };
    case "music_feature":
      return { type: "object", properties: [], additional_properties: true, semantic: "music_feature" };
    case "scene_result":
      return { type: "object", properties: [], additional_properties: true, semantic: "scene_result" };
    case "video_observation":
      return { type: "object", properties: [], additional_properties: true, semantic: "video_observation" };
    case "model_request":
      return { type: "object", properties: [], additional_properties: true, semantic: "model_request" };
    case "model_prediction":
      return { type: "object", properties: [], additional_properties: true, semantic: "model_prediction" };
    case "transcript_segment":
      return { type: "object", properties: [], additional_properties: true, semantic: "transcript_segment" };
    case "audio_event":
      return { type: "object", properties: [], additional_properties: true, semantic: "audio_event" };
    case "text_event":
      return { type: "object", properties: [], additional_properties: true, semantic: "text_event" };
    case "http_request":
      return { type: "object", properties: [], additional_properties: true, semantic: "http_request" };
    case "http_response":
      return { type: "object", properties: [], additional_properties: true, semantic: "http_response" };
    case "object_value":
      return { type: "object", properties: [], additional_properties: true };
    case "data_value":
      return { type: "any" };
    case "song_catalog":
      return { type: "object", properties: [], additional_properties: true, semantic: "song_catalog" };
    case "data_record":
      return { type: "object", properties: [], additional_properties: true, semantic: "data_record" };
    case "data_bucket":
      return { type: "object", properties: [], additional_properties: true, semantic: "data_bucket" };
    case "json_report":
      return { type: "object", properties: [], additional_properties: true, semantic: "json_report" };
    case "dashboard_view":
      return { type: "object", properties: [], additional_properties: true, semantic: "dashboard_view" };
  }
}

function requiredConstant(name: string): ts.Expression {
  const expression = topLevelConstants.get(name);
  if (!expression) {
    throw new Error(`Missing top-level constant ${name}`);
  }
  return expression;
}

function requireCallExpression(expression: ts.Expression, functionName: string): ts.CallExpression {
  const unwrapped = stripExpressionWrapper(expression);
  if (!ts.isCallExpression(unwrapped) || !ts.isIdentifier(unwrapped.expression) || unwrapped.expression.text !== functionName) {
    throw new Error(`Expected ${functionName}(...) call, got ${expression.getText(sourceFile)}`);
  }
  return unwrapped;
}

function requireObjectLiteral(expression: ts.Node | undefined, label: string): ts.ObjectLiteralExpression {
  if (!expression || !ts.isObjectLiteralExpression(stripExpressionWrapper(expression as ts.Expression))) {
    throw new Error(`Expected ${label} object literal`);
  }
  return stripExpressionWrapper(expression as ts.Expression) as ts.ObjectLiteralExpression;
}

function requiredProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression {
  const expression = optionalProperty(object, name);
  if (!expression) {
    throw new Error(`Missing property ${name} in ${object.getText(sourceFile)}`);
  }
  return expression;
}

function optionalProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || propertyNameText(property.name) !== name) {
      continue;
    }
    return property.initializer;
  }
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function readIdentifier(expression: ts.Expression): string {
  const unwrapped = stripExpressionWrapper(expression);
  if (!ts.isIdentifier(unwrapped)) {
    throw new Error(`Expected identifier, got ${expression.getText(sourceFile)}`);
  }
  return unwrapped.text;
}

function readString(expression: ts.Expression, context: Record<string, string> = {}): string {
  const unwrapped = stripExpressionWrapper(expression);
  if (ts.isStringLiteralLike(unwrapped)) {
    return unwrapped.text;
  }
  if (ts.isIdentifier(unwrapped) && context[unwrapped.text] !== undefined) {
    return context[unwrapped.text];
  }
  if (ts.isTemplateExpression(unwrapped)) {
    let value = unwrapped.head.text;
    for (const span of unwrapped.templateSpans) {
      value += readString(span.expression, context);
      value += span.literal.text;
    }
    return value;
  }
  throw new Error(`Expected string literal, got ${expression.getText(sourceFile)}`);
}

function readOptionalString(expression: ts.Expression | null): string | undefined {
  return expression ? readString(expression) : undefined;
}

function readOptionalStringArray(expression: ts.Expression | null): string[] | undefined {
  if (!expression) {
    return undefined;
  }
  const unwrapped = stripExpressionWrapper(expression);
  if (!ts.isArrayLiteralExpression(unwrapped)) {
    throw new Error(`Expected string array, got ${expression.getText(sourceFile)}`);
  }
  return unwrapped.elements.map((element) => readString(element));
}

function readNumber(expression: ts.Expression | undefined): number {
  if (!expression) {
    throw new Error("Expected numeric literal");
  }
  const unwrapped = stripExpressionWrapper(expression);
  if (ts.isNumericLiteral(unwrapped)) {
    return Number(unwrapped.text);
  }
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    unwrapped.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(unwrapped.operand)
  ) {
    return -Number(unwrapped.operand.text);
  }
  throw new Error(`Expected numeric literal, got ${expression.getText(sourceFile)}`);
}

function stripExpressionWrapper(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}
