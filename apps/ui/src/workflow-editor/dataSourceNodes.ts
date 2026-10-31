import { type WorkflowTypeSpec } from "../api/client";
import { workflowTypeSignature } from "../workflowTypeSpec";
import type { DataSourceEntry } from "../run/types";
import { normalizeAdapterTransformSteps } from "./adapterTransforms";
import {
  createDataSourceSchemaPropertyId,
  dataSourcePortType,
  dataSourceSchemaToWorkflowType,
  normalizeDataSourceSchema,
  workflowTypeForPortType,
  workflowTypeToPortType,
} from "./dataSourceSchema";
import { port, portIsStream } from "./ports";
import type {
  AdapterTransformStep,
  DataSourceSchema,
  DataSourceType,
  FlowPort,
  WorkflowNodeData,
} from "./types";

export function workflowNodeDataWithDataSource(data: WorkflowNodeData, dataSource: DataSourceEntry | null): WorkflowNodeData {
  const type = dataSource ? workflowTypeToPortType(dataSource.type, "data_value") : "data_value";
  const nextData: WorkflowNodeData = {
    ...data,
    title: dataSource ? `Data Source: ${dataSource.name}` : "Data Source",
    packageName: "Data Sources",
    description: dataSource
      ? `Emits ${dataSource.name} from data source ID ${dataSource.id}.`
      : "Selects a saved data source by ID and emits its payload through a typed output port.",
    category: "Data",
    tone: data.tone,
    outputs: [dataSourceOutputPort(dataSource, type)],
    dataSourceNode: true,
    dataSourceType: type,
  };
  if (dataSource) {
    nextData.dataSourceId = dataSource.id;
  } else {
    delete nextData.dataSourceId;
  }
  return nextData;
}

export function workflowNodeDataWithAdapter(
  data: WorkflowNodeData,
  inputSchema: DataSourceSchema,
  outputSchema: DataSourceSchema,
  steps: AdapterTransformStep[] = normalizeAdapterTransformSteps(data.adapterSteps),
): WorkflowNodeData {
  const normalizedInput = normalizeDataSourceSchema(inputSchema, { type: "any" });
  const normalizedOutput = normalizeDataSourceSchema(outputSchema, { type: "any" });
  return {
    ...data,
    category: "Data",
    inputs: [adapterPort("source", "source data", normalizedInput)],
    outputs: [adapterPort("result", "adapted data", normalizedOutput)],
    adapterNode: true,
    adapterInputSchema: normalizedInput,
    adapterOutputSchema: normalizedOutput,
    adapterSteps: normalizeAdapterTransformSteps(steps),
  };
}

export function workflowNodeDataWithAdapterSource(data: WorkflowNodeData, sourcePort: FlowPort): WorkflowNodeData {
  const inputSchema = workflowTypeSpecToDataSourceSchema(sourcePort.valueType, sourcePort.type);
  const outputSchema = workflowTypeSpecToDataSourceSchema(sourcePort.valueType, sourcePort.type);
  return {
    ...workflowNodeDataWithAdapter(data, inputSchema, outputSchema),
    inputs: [
      port("source", "source data", sourcePort.type, {
        valueType: structuredClone(sourcePort.valueType),
        optional: sourcePort.optional,
        stream: sourcePort.stream,
      }),
    ],
    outputs: [
      port("result", "adapted data", sourcePort.type, {
        valueType: structuredClone(sourcePort.valueType),
        stream: sourcePort.stream,
      }),
    ],
  };
}

export function workflowNodeDataSourceSynced(current: WorkflowNodeData, expected: WorkflowNodeData): boolean {
  return (
    current.title === expected.title &&
    current.description === expected.description &&
    current.dataSourceId === expected.dataSourceId &&
    current.dataSourceType === expected.dataSourceType &&
    current.outputs.length === expected.outputs.length &&
    current.outputs.every((output, index) => {
      const expectedOutput = expected.outputs[index];
      return (
        expectedOutput &&
        output.id === expectedOutput.id &&
        output.label === expectedOutput.label &&
        output.type === expectedOutput.type &&
        workflowTypeSignature(output.valueType, portIsStream(output)) ===
          workflowTypeSignature(expectedOutput.valueType, portIsStream(expectedOutput))
      );
    })
  );
}

export function dataSourceOutputPort(dataSource: DataSourceEntry | null, fallbackType: DataSourceType): FlowPort {
  const outputType = dataSource ? workflowTypeToPortType(dataSource.type, fallbackType) : fallbackType;
  return port("data", dataSource ? "source data" : "data", outputType, {
    valueType: dataSource ? structuredClone(dataSource.type) : workflowTypeForPortType(outputType),
  });
}

function adapterPort(id: string, label: string, schema: DataSourceSchema): FlowPort {
  const type = dataSourcePortType(schema);
  return port(id, label, type, { valueType: dataSourceSchemaToWorkflowType(schema) });
}

export function workflowTypeSpecToDataSourceSchema(spec: WorkflowTypeSpec, fallbackPortType: DataSourceType = "data_value"): DataSourceSchema {
  switch (spec.type) {
    case "any":
    case "null":
    case "boolean":
    case "number":
      return { type: spec.type };
    case "string":
      return { type: "string", ...(spec.semantic ? { semantic: spec.semantic } : {}) };
    case "binary": {
      const portType = workflowTypeToPortType(spec, fallbackPortType);
      const fallbackType = workflowTypeForPortType(portType);
      const fallbackMediaType = fallbackType.type === "binary" ? fallbackType.media_type : undefined;
      return {
        type: "binary",
        mediaType: spec.media_type || fallbackMediaType || "application/octet-stream",
        portType,
        ...(spec.semantic ? { semantic: spec.semantic } : {}),
      };
    }
    case "array":
      return {
        type: "array",
        items: workflowTypeSpecToDataSourceSchema(spec.items),
        ...(typeof spec.min_items === "number" ? { minItems: spec.min_items } : {}),
        ...(typeof spec.max_items === "number" ? { maxItems: spec.max_items } : {}),
      };
    case "object":
      return {
        type: "object",
        properties: (spec.properties ?? []).map((property) => ({
          id: createDataSourceSchemaPropertyId(),
          name: property.name,
          schema: workflowTypeSpecToDataSourceSchema(property.value),
          required: Boolean(property.required),
        })),
        additionalProperties: spec.additional_properties ?? false,
        ...(spec.additional_property_value
          ? { additionalPropertySchema: workflowTypeSpecToDataSourceSchema(spec.additional_property_value) }
          : {}),
        ...(spec.semantic ? { semantic: spec.semantic } : {}),
      };
    case "union":
      return {
        type: "union",
        variants: spec.variants.map((variant) => workflowTypeSpecToDataSourceSchema(variant, fallbackPortType)),
      };
  }
}
