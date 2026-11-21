import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { withMemoizedJsonSchema } from "./memoizedJsonSchema";

const ToolInputSchema = z.object({
  post_ids: z.array(z.guid()).min(1).max(50),
  response_format: z.enum(["concise", "detailed"]).optional().default("concise"),
});

const DRAFT_TARGET = { target: "draft-2020-12" } as const;

describe("withMemoizedJsonSchema", () => {
  test("returns the JSON Schema zod produces, for input and output", () => {
    const memoizedSchema = withMemoizedJsonSchema(ToolInputSchema);
    const jsonSchema = memoizedSchema["~standard"].jsonSchema;

    expect(jsonSchema.input(DRAFT_TARGET)).toEqual(
      ToolInputSchema["~standard"].jsonSchema.input(DRAFT_TARGET),
    );
    expect(jsonSchema.output(DRAFT_TARGET)).toEqual(
      ToolInputSchema["~standard"].jsonSchema.output(DRAFT_TARGET),
    );
  });

  test("converts once per direction and target, however many servers ask", () => {
    const conversionCalls: string[] = [];
    const countingSchema = withMemoizedJsonSchema({
      "~standard": {
        ...ToolInputSchema["~standard"],
        jsonSchema: {
          input: (options) => {
            conversionCalls.push(`input:${options.target}`);
            return { type: "object" };
          },
          output: (options) => {
            conversionCalls.push(`output:${options.target}`);
            return { type: "object" };
          },
        },
      },
    });

    for (let serverIndex = 0; serverIndex < 5; serverIndex++) {
      countingSchema["~standard"].jsonSchema.input(DRAFT_TARGET);
      countingSchema["~standard"].jsonSchema.output(DRAFT_TARGET);
      countingSchema["~standard"].jsonSchema.input({ target: "draft-07" });
    }

    expect(conversionCalls).toEqual(["input:draft-2020-12", "output:draft-2020-12", "input:draft-07"]);
  });

  test("bypasses the cache when library options are passed", () => {
    let conversionCount = 0;
    const countingSchema = withMemoizedJsonSchema({
      "~standard": {
        ...ToolInputSchema["~standard"],
        jsonSchema: {
          input: () => {
            conversionCount++;
            return { type: "object" };
          },
          output: () => ({ type: "object" }),
        },
      },
    });

    const optionsWithLibrary = { ...DRAFT_TARGET, libraryOptions: { unrepresentable: "any" } };
    countingSchema["~standard"].jsonSchema.input(optionsWithLibrary);
    countingSchema["~standard"].jsonSchema.input(optionsWithLibrary);

    expect(conversionCount).toBe(2);
  });

  test("validates through the wrapped schema, defaults included", async () => {
    const memoizedSchema = withMemoizedJsonSchema(ToolInputSchema);
    const validPostId = "0b6f6a52-3c2e-4a8e-9a43-2f1f5b6e1c11";

    const accepted = await memoizedSchema["~standard"].validate({ post_ids: [validPostId] });
    const refused = await memoizedSchema["~standard"].validate({ post_ids: [] });

    expect(accepted).toEqual({ value: { post_ids: [validPostId], response_format: "concise" } });
    expect(refused.issues?.length).toBeGreaterThan(0);
  });
});
