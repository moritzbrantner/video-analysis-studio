import { type TypeDefinition } from "../type-library/page";
import { formatWorkflowTypeSpec } from "../workflowTypeSpec";
import { Field, Metric } from "../shared/controls";
import { CloseIcon, PlusIcon } from "../shared/icons";
import { classNames } from "../shared/utils";
import { workflowTypeSpecToDataSourceSchema } from "./dataSourceNodes";
import {
  addDataSourceSchemaProperty,
  dataSourceSchemaToWorkflowType,
  defaultDataSourceSchemaForKind,
  removeDataSourceSchemaProperty,
  updateDataSourceSchemaProperty,
} from "./dataSourceSchema";
import { dataSourceOutputTypes, formatPortType } from "./portTypes";
import { customTypeForSpec } from "./resultPanels";
import type { DataSourceSchema, DataSourceType } from "./types";

export function DataSourceSchemaEditor({
  schema,
  onChange,
  typeDefinitions = [],
  depth = 0,
}: {
  schema: DataSourceSchema;
  onChange: (schema: DataSourceSchema) => void;
  typeDefinitions?: TypeDefinition[];
  depth?: number;
}) {
  const updateKind = (kind: DataSourceSchema["type"]) => {
    onChange(defaultDataSourceSchemaForKind(kind));
  };

  return (
    <section className={classNames("rounded-lg border border-zinc-200 bg-zinc-50 p-3", depth > 0 && "bg-white")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={depth === 0 ? "Type" : "Nested type"}>
          <select
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={schema.type}
            onChange={(event) => updateKind(event.target.value as DataSourceSchema["type"])}
          >
            <option value="any">Any JSON</option>
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
            <option value="null">Null</option>
            <option value="binary">Binary</option>
            <option value="array">Array of</option>
            <option value="object">Object</option>
            <option value="union">Union</option>
            <option value="port">Workflow port type</option>
          </select>
        </Field>
        <Metric label="Workflow output" value={formatWorkflowTypeSpec(dataSourceSchemaToWorkflowType(schema))} />
      </div>

      {typeDefinitions.length > 0 && (
        <Field label="Custom type">
          <select
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={customTypeForSpec(dataSourceSchemaToWorkflowType(schema), typeDefinitions)?.id ?? ""}
            onChange={(event) => {
              const definition = typeDefinitions.find((candidate) => candidate.id === event.target.value);
              if (definition) {
                onChange(workflowTypeSpecToDataSourceSchema(definition.spec));
              }
            }}
          >
            <option value="">Use structural type</option>
            {typeDefinitions.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {schema.type === "port" && (
        <Field label="Port type">
          <select
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={schema.portType}
            onChange={(event) => onChange({ type: "port", portType: event.target.value as DataSourceType })}
          >
            {dataSourceOutputTypes.map((type) => (
              <option key={type} value={type}>
                {formatPortType(type)}
              </option>
            ))}
          </select>
        </Field>
      )}

      {schema.type === "binary" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Media type">
            <input
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={schema.mediaType}
              onChange={(event) => onChange({ ...schema, mediaType: event.target.value })}
              placeholder="audio/mpeg"
            />
          </Field>
          <Field label="Port type">
            <select
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={schema.portType}
              onChange={(event) => onChange({ ...schema, portType: event.target.value as DataSourceType })}
            >
              {dataSourceOutputTypes.map((type) => (
                <option key={type} value={type}>
                  {formatPortType(type)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {schema.type === "array" && (
        <div className="mt-3 border-l-2 border-zinc-200 pl-3">
          <DataSourceSchemaEditor
            schema={schema.items}
            typeDefinitions={typeDefinitions}
            onChange={(items) => onChange({ ...schema, items })}
            depth={depth + 1}
          />
        </div>
      )}

      {schema.type === "union" && (
        <div className="mt-3 space-y-3">
          {schema.variants.map((variant, index) => (
            <div key={`variant-${index}`} className="rounded-lg border border-zinc-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase text-zinc-500">Variant {index + 1}</div>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-zinc-600 hover:bg-zinc-50"
                  onClick={() =>
                    onChange({
                      ...schema,
                      variants: schema.variants.filter((_, variantIndex) => variantIndex !== index),
                    })
                  }
                  disabled={schema.variants.length <= 1}
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <DataSourceSchemaEditor
                schema={variant}
                typeDefinitions={typeDefinitions}
                onChange={(nextVariant) =>
                  onChange({
                    ...schema,
                    variants: schema.variants.map((candidate, candidateIndex) =>
                      candidateIndex === index ? nextVariant : candidate,
                    ),
                  })
                }
                depth={depth + 1}
              />
            </div>
          ))}
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            onClick={() => onChange({ ...schema, variants: [...schema.variants, { type: "any" }] })}
          >
            <PlusIcon className="h-4 w-4" />
            Add Variant
          </button>
        </div>
      )}

      {schema.type === "object" && (
        <div className="mt-3 space-y-3">
          <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-zinc-300"
              checked={schema.additionalProperties !== false}
              onChange={(event) => onChange({ ...schema, additionalProperties: event.target.checked })}
            />
            Allow additional properties
          </label>
          {schema.properties.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-4 text-sm text-zinc-500">
              No properties defined.
            </div>
          ) : (
            schema.properties.map((property) => (
              <div key={property.id} className="rounded-lg border border-zinc-200 bg-white p-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    className="min-w-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={property.name}
                    onChange={(event) =>
                      onChange(updateDataSourceSchemaProperty(schema, property.id, { name: event.target.value }))
                    }
                    placeholder="property_name"
                  />
                  <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-zinc-300"
                      checked={property.required}
                      onChange={(event) =>
                        onChange(updateDataSourceSchemaProperty(schema, property.id, { required: event.target.checked }))
                      }
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-zinc-600 hover:bg-zinc-50"
                    onClick={() => onChange(removeDataSourceSchemaProperty(schema, property.id))}
                    title="Remove property"
                    aria-label="Remove property"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 border-l-2 border-zinc-200 pl-3">
                  <DataSourceSchemaEditor
                    schema={property.schema}
                    typeDefinitions={typeDefinitions}
                    onChange={(propertySchema) =>
                      onChange(updateDataSourceSchemaProperty(schema, property.id, { schema: propertySchema }))
                    }
                    depth={depth + 1}
                  />
                </div>
              </div>
            ))
          )}
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            onClick={() => onChange(addDataSourceSchemaProperty(schema))}
          >
            <PlusIcon className="h-4 w-4" />
            Add Property
          </button>
        </div>
      )}
    </section>
  );
}
