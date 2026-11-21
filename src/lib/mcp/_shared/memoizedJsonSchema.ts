import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

type JsonSchemaConverter = StandardSchemaWithJSON["~standard"]["jsonSchema"];
type JsonSchemaOptions = Parameters<JsonSchemaConverter["input"]>[0];
type JsonSchemaDirection = keyof JsonSchemaConverter;

// mcp-handler builds a new McpServer per request (mcp-handler/dist/index.mjs), and the SDK converts every tool
// schema at registration and again on tools/list (@modelcontextprotocol/server/dist/mcp-Dw2OlZ1f.mjs).
export function withMemoizedJsonSchema<Input, Output>(
  schema: StandardSchemaWithJSON<Input, Output>,
): StandardSchemaWithJSON<Input, Output> {
  const standardProps = schema["~standard"];
  const jsonSchemaByKey = new Map<string, Record<string, unknown>>();

  const convertOnce =
    (direction: JsonSchemaDirection) =>
    (options: JsonSchemaOptions): Record<string, unknown> => {
      if (options.libraryOptions !== undefined) {
        return standardProps.jsonSchema[direction](options);
      }
      const cacheKey = `${direction}:${options.target}`;
      const cachedJsonSchema = jsonSchemaByKey.get(cacheKey);
      if (cachedJsonSchema) return cachedJsonSchema;
      const convertedJsonSchema = standardProps.jsonSchema[direction](options);
      jsonSchemaByKey.set(cacheKey, convertedJsonSchema);
      return convertedJsonSchema;
    };

  return {
    "~standard": {
      version: standardProps.version,
      vendor: standardProps.vendor,
      validate: standardProps.validate,
      types: standardProps.types,
      jsonSchema: { input: convertOnce("input"), output: convertOnce("output") },
    },
  };
}
