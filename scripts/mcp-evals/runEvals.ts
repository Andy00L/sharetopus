// Runs every eval task with Claude against the old tool set (tools-before.json) and the new one
// (tools-after.json plus its server instructions), executing tool calls against the mock world.
// Run: bun scripts/mcp-evals/runEvals.ts [--model claude-sonnet-5-5] [--repeat 1] [--only before|after] [--task id]
// Needs ANTHROPIC_API_KEY (bun loads .env). Writes scripts/mcp-evals/results-<model>.json.
import { readFile, writeFile } from "node:fs/promises";

import { EVAL_NOW, createMockWorld, isJsonObject, runMockTool, type JsonObject, type ToolSetVersion } from "./mockWorld";
import { EVAL_TASKS, type EvalTask } from "./tasks";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** Turns one task may take before it counts as a failure. */
const MAX_TURNS = 16;
const MAX_OUTPUT_TOKENS = 2048;
/** HTTP statuses worth retrying (rate limit, overload, transient server errors). */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 529]);
const MAX_ATTEMPTS = 4;

const BASE_SYSTEM_PROMPT = `You manage the user's social media through the Sharetopus tools. The current time is ${EVAL_NOW} (Tuesday). Complete the request without asking the user anything; make reasonable choices. Finish with a short summary of what you did.`;

type AnthropicTool = { name: string; description: string; input_schema: JsonObject };
type ToolSet = { version: ToolSetVersion; tools: AnthropicTool[]; instructions: string | null };
type ConversationMessage = { role: "user" | "assistant"; content: string | JsonObject[] };

type MessageResult =
  | { ok: true; content: JsonObject[]; stopReason: string; inputTokens: number; outputTokens: number }
  | { ok: false; message: string };

type RunResult = {
  task: string;
  version: ToolSetVersion;
  passed: boolean;
  reason: string;
  toolCalls: number;
  toolErrors: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  calls: string[];
};

function withoutSchemaKey(schema: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(schema).filter(([schemaKey]) => schemaKey !== "$schema"));
}

/** Reads one tool set from its dump file; the old file is a bare array, the new one a tools/list result. */
async function loadToolSet(version: ToolSetVersion): Promise<{ ok: true; toolSet: ToolSet } | { ok: false; message: string }> {
  const path = new URL(version === "before" ? "./tools-before.json" : "./tools-after.json", import.meta.url);
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  const rawTools = version === "before" ? parsed : isJsonObject(parsed) && isJsonObject(parsed.tools) ? parsed.tools.tools : null;
  if (!Array.isArray(rawTools)) return { ok: false, message: `${version}: no tool array` };

  const tools: AnthropicTool[] = [];
  for (const rawTool of rawTools) {
    if (!isJsonObject(rawTool) || typeof rawTool.name !== "string") return { ok: false, message: `${version}: malformed tool` };
    const schema = version === "before" ? rawTool.input_schema : rawTool.inputSchema;
    if (!isJsonObject(schema)) return { ok: false, message: `${version}: ${rawTool.name} has no input schema` };
    tools.push({ name: rawTool.name, description: typeof rawTool.description === "string" ? rawTool.description : "", input_schema: withoutSchemaKey(schema) });
  }
  const instructions =
    version === "after" && isJsonObject(parsed) && isJsonObject(parsed.initialize) && typeof parsed.initialize.instructions === "string"
      ? parsed.initialize.instructions
      : null;
  return { ok: true, toolSet: { version, tools, instructions } };
}

function readUsageCount(usage: unknown, key: string): number {
  return isJsonObject(usage) && typeof usage[key] === "number" ? usage[key] : 0;
}

/** One Messages API call with retries on rate limits and overloads. */
async function createMessage(apiKey: string, body: JsonObject): Promise<MessageResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch((err: unknown) => err instanceof Error ? err : new Error(String(err)));
    if (response instanceof Error) return { ok: false, message: `network: ${response.message}` };

    if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
      const retryAfterSeconds = Number(response.headers.get("retry-after")) || attempt * 5;
      console.warn(`[createMessage] HTTP ${response.status}, retry ${attempt} in ${retryAfterSeconds}s`);
      await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
      continue;
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !isJsonObject(payload) || !Array.isArray(payload.content)) {
      return { ok: false, message: `HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}` };
    }
    return {
      ok: true,
      content: payload.content.filter(isJsonObject),
      stopReason: typeof payload.stop_reason === "string" ? payload.stop_reason : "",
      inputTokens: readUsageCount(payload.usage, "input_tokens"),
      outputTokens: readUsageCount(payload.usage, "output_tokens"),
    };
  }
  return { ok: false, message: "retries exhausted" };
}

/** Runs one task to its final answer on a fresh mock world and grades it. */
async function runTask(apiKey: string, model: string, task: EvalTask, toolSet: ToolSet): Promise<RunResult> {
  const world = createMockWorld();
  const system = toolSet.instructions ? `${BASE_SYSTEM_PROMPT}\n\n<server_instructions>\n${toolSet.instructions}\n</server_instructions>` : BASE_SYSTEM_PROMPT;
  const messages: ConversationMessage[] = [{ role: "user", content: task.prompt }];
  const result: RunResult = { task: task.id, version: toolSet.version, passed: false, reason: "", toolCalls: 0, toolErrors: 0, turns: 0, inputTokens: 0, outputTokens: 0, calls: [] };
  let finalText = "";

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const message = await createMessage(apiKey, { model, max_tokens: MAX_OUTPUT_TOKENS, system, tools: toolSet.tools, messages });
    if (!message.ok) return { ...result, reason: `API error: ${message.message}` };
    result.turns = turn;
    result.inputTokens += message.inputTokens;
    result.outputTokens += message.outputTokens;
    messages.push({ role: "assistant", content: message.content });

    const toolUses = message.content.filter((block) => block.type === "tool_use");
    finalText = message.content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => String(block.text))
      .join("\n");
    if (message.stopReason !== "tool_use" || toolUses.length === 0) break;

    const toolResults = toolUses.map((toolUse) => {
      const toolName = typeof toolUse.name === "string" ? toolUse.name : "";
      const toolResult = runMockTool(world, toolSet.version, toolName, isJsonObject(toolUse.input) ? toolUse.input : {});
      result.toolCalls++;
      if (toolResult.isError) result.toolErrors++;
      result.calls.push(`${toolName}${toolResult.isError ? " (error)" : ""}`);
      return { type: "tool_result", tool_use_id: toolUse.id, content: toolResult.text, is_error: toolResult.isError };
    });
    messages.push({ role: "user", content: toolResults });
    if (turn === MAX_TURNS) return { ...result, reason: `no final answer after ${MAX_TURNS} turns` };
  }

  const verdict = task.check(world, finalText);
  return { ...result, passed: verdict.passed, reason: verdict.reason };
}

function readFlag(name: string): string | undefined {
  const flagIndex = process.argv.indexOf(`--${name}`);
  return flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
}

function summarize(results: RunResult[], version: ToolSetVersion): string {
  const versionResults = results.filter((result) => result.version === version);
  const sumOf = (pick: (result: RunResult) => number) => versionResults.reduce((total, result) => total + pick(result), 0);
  const passed = versionResults.filter((result) => result.passed).length;
  return `${version.padEnd(6)} passed ${passed}/${versionResults.length}  calls ${sumOf((result) => result.toolCalls)}  errors ${sumOf((result) => result.toolErrors)}  input tokens ${sumOf((result) => result.inputTokens)}  output tokens ${sumOf((result) => result.outputTokens)}`;
}

async function runEvals(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[runEvals] ANTHROPIC_API_KEY is missing. Add it to .env, then rerun.");
    process.exit(1);
  }
  const model = readFlag("model") ?? "claude-sonnet-5-5";
  const repeat = Number(readFlag("repeat") ?? "1");
  const onlyVersion = readFlag("only");
  const onlyTask = readFlag("task");
  const versions: ToolSetVersion[] = onlyVersion === "before" || onlyVersion === "after" ? [onlyVersion] : ["before", "after"];

  const toolSets: ToolSet[] = [];
  for (const version of versions) {
    const loaded = await loadToolSet(version);
    if (!loaded.ok) {
      console.error(`[runEvals] ${loaded.message}`);
      process.exit(1);
    }
    toolSets.push(loaded.toolSet);
  }

  const results: RunResult[] = [];
  for (const task of EVAL_TASKS.filter((candidate) => !onlyTask || candidate.id === onlyTask)) {
    for (const toolSet of toolSets) {
      for (let round = 1; round <= repeat; round++) {
        const result = await runTask(apiKey, model, task, toolSet);
        results.push(result);
        console.log(`[runEvals] ${task.id} ${toolSet.version} #${round}: ${result.passed ? "PASS" : "FAIL"} (${result.reason}) calls=${result.toolCalls} errors=${result.toolErrors} in=${result.inputTokens} out=${result.outputTokens} [${result.calls.join(", ")}]`);
      }
    }
  }

  console.log(`\n[runEvals] model ${model}, ${repeat} run(s) per task`);
  for (const version of versions) console.log(`[runEvals] ${summarize(results, version)}`);
  const outPath = new URL(`./results-${model}.json`, import.meta.url);
  await writeFile(outPath, `${JSON.stringify({ model, repeat, ranAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`[runEvals] results -> ${outPath.pathname}`);
}

await runEvals();
