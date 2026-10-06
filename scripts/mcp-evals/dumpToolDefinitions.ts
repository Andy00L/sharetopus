// Writes the tool list and server instructions exactly as an MCP client receives them.
// Run: bun --conditions=react-server scripts/mcp-evals/dumpToolDefinitions.ts scripts/mcp-evals/tools-after.json
import { writeFile } from "node:fs/promises";

import {
  InMemoryTransport,
  McpServer,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";

import { MCP_SERVER_INSTRUCTIONS } from "../../src/lib/mcp/serverInstructions";
import { registerTools } from "../../src/lib/mcp/tools";

/** The 2025-era handshake; the server answers it through its stateless fallback. */
const PROTOCOL_VERSION = "2025-11-25";

type JsonRpcResponse = { id: number; result?: unknown; error?: { message: string } };

function isJsonRpcResponse(message: JSONRPCMessage): message is JSONRPCMessage & JsonRpcResponse {
  return "id" in message && ("result" in message || "error" in message);
}

/** Connects a raw JSON-RPC client to a real McpServer and returns tools/list plus the instructions. */
async function dumpToolDefinitions(outPath: string): Promise<void> {
  const server = new McpServer(
    { name: "Sharetopus", version: "eval" },
    { instructions: MCP_SERVER_INSTRUCTIONS, capabilities: { tools: { listChanged: false } } },
  );
  registerTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pendingById = new Map<number, (response: JsonRpcResponse) => void>();
  clientTransport.onmessage = (message) => {
    if (isJsonRpcResponse(message)) pendingById.get(message.id)?.(message);
  };
  await server.connect(serverTransport);
  await clientTransport.start();

  let nextId = 1;
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<JsonRpcResponse>((resolve) => {
      const id = nextId++;
      pendingById.set(id, resolve);
      void clientTransport.send({ jsonrpc: "2.0", id, method, params });
    });

  const initialize = await request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "mcp-evals", version: "1" },
  });
  if (initialize.error) {
    console.error("[dumpToolDefinitions] initialize failed:", initialize.error.message);
    process.exit(1);
  }
  await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const toolsList = await request("tools/list", {});
  if (toolsList.error) {
    console.error("[dumpToolDefinitions] tools/list failed:", toolsList.error.message);
    process.exit(1);
  }

  const dump = { initialize: initialize.result, tools: toolsList.result };
  await writeFile(outPath,`${JSON.stringify(dump, null, 2)}\n`);
  console.log(
    `[dumpToolDefinitions] ${JSON.stringify(toolsList.result).length} chars of tool definitions -> ${outPath}`,
  );
  await server.close();
}

const outPath = process.argv[2];
if (!outPath) {
  console.error("[dumpToolDefinitions] usage: dumpToolDefinitions.ts <out.json>");
  process.exit(1);
}
await dumpToolDefinitions(outPath);
