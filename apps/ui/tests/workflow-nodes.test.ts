import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

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
  | "dashboard_view";

interface FlowPortFixture {
  id: string;
  label: string;
  type: PortType;
  optional?: boolean;
  stream?: boolean;
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

const workflowNodeArrayNames = [
  "initialWorkflowNodes",
  "dashboardWorkflowNodes",
  "generatorWorkflowNodes",
  "adapterWorkflowNodes",
  "streamWorkflowNodes",
  "httpWorkflowNodes",
  "controlFlowWorkflowNodes",
] as const;

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

const workflowSource = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8");
const rustWorkflowCatalogSource = readFileSync(
  join(import.meta.dir, "../../../../rust-packages/crates/video/video-analysis-use-cases/src/workflow_catalog.rs"),
  "utf8",
);
const sourceFile = ts.createSourceFile("main.tsx", workflowSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const topLevelConstants = collectTopLevelConstants(sourceFile);
const portTypes = new Set(readStringArrayConstant("portTypes") as PortType[]);
const dataValueCompatibleSourceTypes = new Set(readStringArrayConstant("dataValueCompatibleSourceTypes") as PortType[]);
const streamablePortTypes = new Set(readStringArrayConstant("streamablePortTypes") as PortType[]);
const streamBridgePortDescriptors = readStreamBridgePortDescriptors();

const nodesByArrayName = new Map(
  workflowNodeArrayNames.map((arrayName) => [arrayName, readWorkflowNodeArray(arrayName)]),
);
const workflowNodes = workflowNodeArrayNames.flatMap((arrayName) => nodesByArrayName.get(arrayName) ?? []);
const initialWorkflowNodes = nodesByArrayName.get("initialWorkflowNodes") ?? [];
const initialWorkflowEdges = readInitialWorkflowEdges();

describe("workflow node catalog", () => {
  test("workflowNodeTemplates includes every node category array", () => {
    expect(readWorkflowTemplateArrayNames()).toEqual([...workflowNodeArrayNames]);
  });

  test("node IDs are unique across the catalog", () => {
    const ids = workflowNodes.map((node) => node.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  test("Rust workflow catalog processing nodes exist in the TS template set", () => {
    const rustNodeIds = [...rustWorkflowCatalogSource.matchAll(/node\(\s*"([^"]+)"/g)].map((match) => match[1]);
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
          if (port.stream) {
            expect(streamablePortTypes.has(port.type)).toBe(true);
          }
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

function portsCompatible(sourcePort: FlowPortFixture, targetPort: FlowPortFixture): boolean {
  const streamConnection = sourcePort.stream === true || targetPort.stream === true;
  if (streamConnection) {
    return (
      sourcePort.stream === true &&
      targetPort.stream === true &&
      streamablePortTypes.has(sourcePort.type) &&
      streamablePortTypes.has(targetPort.type) &&
      portTypesCompatible(sourcePort.type, targetPort.type)
    );
  }
  return portTypesCompatible(sourcePort.type, targetPort.type);
}

function portTypesCompatible(sourceType: PortType, targetType: PortType): boolean {
  return sourceType === targetType || (targetType === "data_value" && dataValueCompatibleSourceTypes.has(sourceType));
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
