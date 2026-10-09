import ts from "@typescript/typescript6";

import type { WorkflowObjectProperty, WorkflowSemanticKind, WorkflowTypeSpec } from "./api/client";

type TypeDeclaration = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

const syntheticTypeName = "__WorkflowType";
const builtinDeclarationNames = new Set(["WorkflowSemantic", "WorkflowBinary"]);

const semanticKinds = new Set<WorkflowSemanticKind>([
  "run_request",
  "run_config",
  "template_string",
  "youtube_url",
  "youtube_collection_url",
  "video_file",
  "audio_file",
  "audio_wav",
  "media_file",
  "transcript",
  "subtitle_file",
  "video_metadata",
  "scene_result",
  "video_observation",
  "model_request",
  "model_prediction",
  "transcript_segment",
  "audio_event",
  "text_event",
  "collection_manifest",
  "collection_item",
  "collection_report",
  "collection_table",
  "song_fingerprint",
  "song_catalog",
  "song_match",
  "music_feature",
  "http_request",
  "http_response",
  "json_report",
  "dashboard_view",
  "data_record",
  "data_bucket",
]);

const builtinTypeSpecs: Record<string, WorkflowTypeSpec> = {
  YouTubeUrl: { type: "string", semantic: "youtube_url" },
  TemplateString: { type: "string", semantic: "template_string" },
  Transcript: openObject("transcript"),
  SongCatalog: openObject("song_catalog"),
  VideoFile: { type: "binary", media_type: "video/*", semantic: "video_file" },
  AudioFile: { type: "binary", media_type: "audio/*", semantic: "audio_file" },
  MediaFile: { type: "binary", semantic: "media_file" },
};

const semanticStringAliases: Partial<Record<WorkflowSemanticKind, string>> = {
  youtube_url: "YouTubeUrl",
  template_string: "TemplateString",
};

const semanticObjectAliases: Partial<Record<WorkflowSemanticKind, string>> = {
  transcript: "Transcript",
  song_catalog: "SongCatalog",
};

interface ParseContext {
  sourceFile: ts.SourceFile;
  declarations: Map<string, TypeDeclaration>;
  resolving: Set<string>;
}

export function parseWorkflowTypeScriptType(source: string, preferredName?: string): WorkflowTypeSpec {
  const sourceFile = parseSourceFile(source);
  const declarations = collectDeclarations(sourceFile);
  const selected = selectDeclaration(declarations, preferredName);
  const context: ParseContext = {
    sourceFile,
    declarations,
    resolving: new Set(),
  };

  if (ts.isInterfaceDeclaration(selected)) {
    return parseInterfaceDeclaration(selected, context);
  }
  if (selected.typeParameters && selected.typeParameters.length > 0) {
    throw new Error(`Generic type alias "${selected.name.text}" is not supported.`);
  }
  return parseTypeNode(selected.type, context);
}

export function workflowTypeSpecFromTsSource(source: string): WorkflowTypeSpec {
  return parseWorkflowTypeScriptType(source);
}

export function formatWorkflowTypeScriptType(spec: WorkflowTypeSpec): string {
  return `type WorkflowType = ${formatType(spec)};\n`;
}

function parseSourceFile(source: string): ts.SourceFile {
  const trimmed = source.trim();
  const text = startsWithTypeDeclaration(trimmed) ? trimmed : `type ${syntheticTypeName} = ${trimmed || "unknown"};`;
  const sourceFile = ts.createSourceFile("workflow-type.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    throw new Error(ts.flattenDiagnosticMessageText(parseDiagnostics[0].messageText, "\n"));
  }
  return sourceFile;
}

function startsWithTypeDeclaration(source: string): boolean {
  return /^(export\s+)?(type|interface|class)\s/.test(source);
}

function collectDeclarations(sourceFile: ts.SourceFile): Map<string, TypeDeclaration> {
  const declarations = new Map<string, TypeDeclaration>();
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      if (builtinDeclarationNames.has(statement.name.text)) {
        continue;
      }
      declarations.set(statement.name.text, statement);
      continue;
    }
    if (ts.isInterfaceDeclaration(statement)) {
      declarations.set(statement.name.text, statement);
      continue;
    }
    if (ts.isClassDeclaration(statement)) {
      throw new Error("Class types are not supported. Use an interface or type literal.");
    }
    if (statement.kind === ts.SyntaxKind.EndOfFileToken) {
      continue;
    }
    throw new Error("Only TypeScript type aliases and interfaces are supported.");
  }
  if (declarations.size === 0) {
    throw new Error("No TypeScript type alias or interface was found.");
  }
  return declarations;
}

function selectDeclaration(declarations: Map<string, TypeDeclaration>, preferredName?: string): TypeDeclaration {
  if (preferredName) {
    const preferred = declarations.get(preferredName);
    if (!preferred) {
      throw new Error(`Type "${preferredName}" was not found.`);
    }
    return preferred;
  }
  const synthetic = declarations.get(syntheticTypeName);
  if (synthetic) {
    return synthetic;
  }
  return [...declarations.values()][declarations.size - 1];
}

function parseTypeNode(node: ts.TypeNode, context: ParseContext): WorkflowTypeSpec {
  if (ts.isParenthesizedTypeNode(node)) {
    return parseTypeNode(node.type, context);
  }
  if (ts.isTypeLiteralNode(node)) {
    return parseObjectMembers(node.members, context);
  }
  if (ts.isInterfaceDeclaration(node)) {
    return parseInterfaceDeclaration(node, context);
  }
  if (ts.isArrayTypeNode(node)) {
    return { type: "array", items: parseTypeNode(node.elementType, context) };
  }
  if (ts.isTupleTypeNode(node)) {
    return parseTupleType(node, context);
  }
  if (ts.isUnionTypeNode(node)) {
    return unionType(node.types.map((type) => parseTypeNode(type, context)));
  }
  if (ts.isIntersectionTypeNode(node)) {
    return parseIntersectionType(node, context);
  }
  if (ts.isTypeReferenceNode(node)) {
    return parseTypeReference(node, context);
  }
  if (ts.isLiteralTypeNode(node)) {
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) {
      return { type: "null" };
    }
    throw new Error("Literal types are not supported. Use string, number, boolean, or a future enum-like workflow type.");
  }
  if (ts.isFunctionTypeNode(node)) {
    throw new Error("Function types are not supported in workflow type contracts.");
  }
  if (ts.isMappedTypeNode(node)) {
    throw new Error("Mapped types are not supported. Use Record<string, T> or an explicit object type.");
  }
  if (ts.isConditionalTypeNode(node)) {
    throw new Error("Conditional types are not supported in workflow type contracts.");
  }

  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { type: "string" };
    case ts.SyntaxKind.NumberKeyword:
      return { type: "number" };
    case ts.SyntaxKind.BooleanKeyword:
      return { type: "boolean" };
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return { type: "any" };
    case ts.SyntaxKind.ObjectKeyword:
      return openObject();
    case ts.SyntaxKind.NeverKeyword:
      throw new Error("never is not supported as a workflow type.");
    default:
      throw new Error(`Unsupported TypeScript type syntax: ${node.getText(context.sourceFile)}`);
  }
}

function parseInterfaceDeclaration(node: ts.InterfaceDeclaration, context: ParseContext): WorkflowTypeSpec {
  if (node.typeParameters && node.typeParameters.length > 0) {
    throw new Error(`Generic interface "${node.name.text}" is not supported.`);
  }
  if (node.heritageClauses && node.heritageClauses.length > 0) {
    throw new Error(`Interface inheritance is not supported for "${node.name.text}". Use an intersection type.`);
  }
  return parseObjectMembers(node.members, context);
}

function parseObjectMembers(members: ts.NodeArray<ts.TypeElement>, context: ParseContext): WorkflowTypeSpec {
  const properties: WorkflowObjectProperty[] = [];
  let additionalPropertyValue: WorkflowTypeSpec | undefined;

  for (const member of members) {
    if (ts.isPropertySignature(member)) {
      properties.push(parsePropertySignature(member, context));
      continue;
    }
    if (ts.isIndexSignatureDeclaration(member)) {
      additionalPropertyValue = parseIndexSignature(member, context);
      continue;
    }
    if (ts.isMethodSignature(member) || ts.isConstructSignatureDeclaration(member) || ts.isCallSignatureDeclaration(member)) {
      throw new Error("Function members are not supported in workflow object types.");
    }
    throw new Error(`Unsupported object member: ${member.getText(context.sourceFile)}`);
  }

  return {
    type: "object",
    properties,
    additional_properties: Boolean(additionalPropertyValue),
    ...(additionalPropertyValue ? { additional_property_value: additionalPropertyValue } : {}),
  };
}

function parsePropertySignature(member: ts.PropertySignature, context: ParseContext): WorkflowObjectProperty {
  if (!member.type) {
    throw new Error(`Property "${member.name.getText(context.sourceFile)}" is missing a type.`);
  }
  return {
    name: propertyName(member.name, context),
    value: parseTypeNode(member.type, context),
    required: !member.questionToken,
  };
}

function propertyName(name: ts.PropertyName, context: ParseContext): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  throw new Error(`Computed property names are not supported: ${name.getText(context.sourceFile)}`);
}

function parseIndexSignature(member: ts.IndexSignatureDeclaration, context: ParseContext): WorkflowTypeSpec {
  if (member.parameters.length !== 1 || member.parameters[0].type?.kind !== ts.SyntaxKind.StringKeyword) {
    throw new Error("Only string index signatures are supported.");
  }
  if (!member.type) {
    throw new Error("Index signatures must include a value type.");
  }
  return parseTypeNode(member.type, context);
}

function parseTupleType(node: ts.TupleTypeNode, context: ParseContext): WorkflowTypeSpec {
  const items = node.elements.map((element) => {
    if (ts.isNamedTupleMember(element)) {
      if (element.questionToken || element.dotDotDotToken) {
        throw new Error("Optional and rest tuple elements are not supported.");
      }
      return parseTypeNode(element.type, context);
    }
    if (ts.isOptionalTypeNode(element) || ts.isRestTypeNode(element)) {
      throw new Error("Optional and rest tuple elements are not supported.");
    }
    return parseTypeNode(element, context);
  });
  return {
    type: "array",
    items: unionType(items.length > 0 ? items : [{ type: "any" }]),
    min_items: items.length,
    max_items: items.length,
  };
}

function parseTypeReference(node: ts.TypeReferenceNode, context: ParseContext): WorkflowTypeSpec {
  const name = typeReferenceName(node, context);
  if (name === "Array") {
    requireTypeArgumentCount(name, node, 1);
    return { type: "array", items: parseTypeNode(node.typeArguments![0], context) };
  }
  if (name === "Record") {
    requireTypeArgumentCount(name, node, 2);
    const keyType = node.typeArguments![0];
    if (keyType.kind !== ts.SyntaxKind.StringKeyword) {
      throw new Error("Only Record<string, T> is supported.");
    }
    return {
      type: "object",
      properties: [],
      additional_properties: true,
      additional_property_value: parseTypeNode(node.typeArguments![1], context),
    };
  }
  if (name === "WorkflowBinary") {
    return workflowBinaryReference(node, context);
  }
  if (name === "WorkflowSemantic") {
    throw new Error("WorkflowSemantic<K> must be used in an intersection, such as string & WorkflowSemantic<\"youtube_url\">.");
  }
  const builtin = builtinTypeSpecs[name];
  if (builtin) {
    return structuredClone(builtin);
  }
  const declaration = context.declarations.get(name);
  if (!declaration) {
    throw new Error(`Unknown type reference "${name}".`);
  }
  if (context.resolving.has(name)) {
    throw new Error(`Recursive type reference "${name}" is not supported.`);
  }
  context.resolving.add(name);
  try {
    if (ts.isInterfaceDeclaration(declaration)) {
      return parseInterfaceDeclaration(declaration, context);
    }
    if (declaration.typeParameters && declaration.typeParameters.length > 0) {
      throw new Error(`Generic type alias "${name}" is not supported.`);
    }
    return parseTypeNode(declaration.type, context);
  } finally {
    context.resolving.delete(name);
  }
}

function typeReferenceName(node: ts.TypeReferenceNode, context: ParseContext): string {
  if (ts.isIdentifier(node.typeName)) {
    return node.typeName.text;
  }
  throw new Error(`Qualified type names are not supported: ${node.typeName.getText(context.sourceFile)}`);
}

function requireTypeArgumentCount(name: string, node: ts.TypeReferenceNode, count: number) {
  if ((node.typeArguments?.length ?? 0) !== count) {
    throw new Error(`${name} requires ${count} type argument${count === 1 ? "" : "s"}.`);
  }
}

function parseIntersectionType(node: ts.IntersectionTypeNode, context: ParseContext): WorkflowTypeSpec {
  let base: WorkflowTypeSpec | undefined;
  let semantic: WorkflowSemanticKind | undefined;

  for (const part of node.types) {
    if (ts.isTypeReferenceNode(part) && typeReferenceName(part, context) === "WorkflowSemantic") {
      semantic = workflowSemanticReference(part, context);
      continue;
    }
    const parsed = parseTypeNode(part, context);
    base = base ? intersectSpecs(base, parsed) : parsed;
  }

  if (!base) {
    throw new Error("Intersections must include a concrete workflow type.");
  }
  if (semantic) {
    return applySemantic(base, semantic);
  }
  return base;
}

function workflowSemanticReference(node: ts.TypeReferenceNode, context: ParseContext): WorkflowSemanticKind {
  requireTypeArgumentCount("WorkflowSemantic", node, 1);
  return semanticTypeArgument(node.typeArguments![0], context);
}

function workflowBinaryReference(node: ts.TypeReferenceNode, context: ParseContext): WorkflowTypeSpec {
  const args = node.typeArguments ?? [];
  if (args.length > 2) {
    throw new Error("WorkflowBinary accepts at most two type arguments.");
  }
  const mediaType = args[0] ? optionalStringTypeArgument(args[0], context) : undefined;
  const semantic = args[1] && args[1].kind !== ts.SyntaxKind.NeverKeyword ? semanticTypeArgument(args[1], context) : undefined;
  return {
    type: "binary",
    ...(mediaType ? { media_type: mediaType } : {}),
    ...(semantic ? { semantic } : {}),
  };
}

function semanticTypeArgument(node: ts.TypeNode, context: ParseContext): WorkflowSemanticKind {
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    const semantic = node.literal.text;
    if (semanticKinds.has(semantic as WorkflowSemanticKind)) {
      return semantic as WorkflowSemanticKind;
    }
  }
  throw new Error(`Expected a WorkflowSemanticKind string literal, got ${node.getText(context.sourceFile)}.`);
}

function optionalStringTypeArgument(node: ts.TypeNode, context: ParseContext): string | undefined {
  if (node.kind === ts.SyntaxKind.StringKeyword) {
    return undefined;
  }
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    return node.literal.text;
  }
  throw new Error(`Expected a string literal or string, got ${node.getText(context.sourceFile)}.`);
}

function intersectSpecs(left: WorkflowTypeSpec, right: WorkflowTypeSpec): WorkflowTypeSpec {
  if (left.type === "any") {
    return right;
  }
  if (right.type === "any") {
    return left;
  }
  if (left.type === "object" && right.type === "object") {
    return intersectObjects(left, right);
  }
  if (JSON.stringify(left) === JSON.stringify(right)) {
    return left;
  }
  throw new Error(`Unsupported intersection between ${left.type} and ${right.type}.`);
}

function intersectObjects(
  left: Extract<WorkflowTypeSpec, { type: "object" }>,
  right: Extract<WorkflowTypeSpec, { type: "object" }>,
): WorkflowTypeSpec {
  const properties = new Map<string, WorkflowObjectProperty>();
  for (const property of [...(left.properties ?? []), ...(right.properties ?? [])]) {
    const existing = properties.get(property.name);
    properties.set(
      property.name,
      existing
        ? {
            name: property.name,
            value: intersectSpecs(existing.value, property.value),
            required: Boolean(existing.required || property.required),
          }
        : { ...property, required: Boolean(property.required) },
    );
  }
  const leftAdditional = left.additional_properties ?? false;
  const rightAdditional = right.additional_properties ?? false;
  const additional_properties = leftAdditional && rightAdditional;
  const additional_property_value =
    left.additional_property_value && right.additional_property_value
      ? intersectSpecs(left.additional_property_value, right.additional_property_value)
      : left.additional_property_value ?? right.additional_property_value;

  return {
    type: "object",
    properties: [...properties.values()],
    additional_properties,
    ...(additional_properties && additional_property_value ? { additional_property_value } : {}),
    ...(left.semantic ?? right.semantic ? { semantic: left.semantic ?? right.semantic } : {}),
  };
}

function applySemantic(spec: WorkflowTypeSpec, semantic: WorkflowSemanticKind): WorkflowTypeSpec {
  switch (spec.type) {
    case "string":
    case "binary":
    case "object":
      return { ...spec, semantic };
    default:
      throw new Error(`Workflow semantics can only brand string, binary, or object types, not ${spec.type}.`);
  }
}

function unionType(variants: WorkflowTypeSpec[]): WorkflowTypeSpec {
  const flattened = variants.flatMap((variant) => (variant.type === "union" ? variant.variants : [variant]));
  if (flattened.length === 1) {
    return flattened[0];
  }
  return { type: "union", variants: flattened };
}

function openObject(semantic?: WorkflowSemanticKind): WorkflowTypeSpec {
  return {
    type: "object",
    properties: [],
    additional_properties: true,
    ...(semantic ? { semantic } : {}),
  };
}

function formatType(spec: WorkflowTypeSpec): string {
  switch (spec.type) {
    case "any":
      return "unknown";
    case "null":
      return "null";
    case "boolean":
    case "number":
    case "string":
      return formatScalar(spec);
    case "binary":
      return formatBinary(spec);
    case "array":
      return `${formatTypeWithParens(spec.items)}[]`;
    case "union":
      return spec.variants.map(formatTypeWithParens).join(" | ");
    case "object":
      return formatObject(spec);
  }
}

function formatScalar(spec: Extract<WorkflowTypeSpec, { type: "boolean" | "number" | "string" }>): string {
  if (spec.type !== "string") {
    return spec.type;
  }
  if (spec.semantic && semanticStringAliases[spec.semantic]) {
    return semanticStringAliases[spec.semantic]!;
  }
  return spec.semantic ? `string & WorkflowSemantic<"${spec.semantic}">` : "string";
}

function formatBinary(spec: Extract<WorkflowTypeSpec, { type: "binary" }>): string {
  const media = spec.media_type ? `"${spec.media_type}"` : "string";
  const semantic = spec.semantic ? `, "${spec.semantic}"` : "";
  return `WorkflowBinary<${media}${semantic}>`;
}

function formatObject(spec: Extract<WorkflowTypeSpec, { type: "object" }>): string {
  const properties = spec.properties ?? [];
  if (properties.length === 0 && spec.additional_properties && !spec.additional_property_value && spec.semantic && semanticObjectAliases[spec.semantic]) {
    return semanticObjectAliases[spec.semantic]!;
  }
  const base =
    properties.length === 0 && spec.additional_properties && !spec.additional_property_value
      ? "object"
      : formatObjectLiteral(spec);
  return spec.semantic ? `(${base}) & WorkflowSemantic<"${spec.semantic}">` : base;
}

function formatObjectLiteral(spec: Extract<WorkflowTypeSpec, { type: "object" }>): string {
  const lines = (spec.properties ?? []).map((property) => {
    const optional = property.required ? "" : "?";
    return `  ${property.name}${optional}: ${formatType(property.value)};`;
  });
  if (spec.additional_properties) {
    lines.push(`  [key: string]: ${spec.additional_property_value ? formatType(spec.additional_property_value) : "unknown"};`);
  }
  return `{\n${lines.join("\n")}\n}`;
}

function formatTypeWithParens(spec: WorkflowTypeSpec): string {
  if (spec.type === "union") {
    return `(${formatType(spec)})`;
  }
  return formatType(spec);
}
