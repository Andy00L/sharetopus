import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Static instructions for connecting an MCP client to Sharetopus.
 *
 * Shows the endpoint URL and auth configuration for Claude Desktop,
 * Cursor, and generic MCP clients.
 *
 * Called by: src/app/(protected)/integrations/page.tsx
 */
export function McpDocsCard() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
  const mcpUrl = `${baseUrl}/api/mcp/streamable-http`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect an AI Client</CardTitle>
        <CardDescription>
          Use the Model Context Protocol to let AI assistants manage your social media.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Claude Desktop */}
        <div>
          <h3 className="mb-2 text-sm font-medium">Claude Desktop</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Add this to your Claude Desktop MCP settings (Settings &gt; Developer &gt; MCP Servers):
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`{
  "mcpServers": {
    "sharetopus": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer stp_mcp_YOUR_KEY_HERE"
      }
    }
  }
}`}
          </pre>
        </div>

        {/* Cursor */}
        <div>
          <h3 className="mb-2 text-sm font-medium">Cursor</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Add a new MCP server in Cursor settings:
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`URL: ${mcpUrl}
Auth: Bearer stp_mcp_YOUR_KEY_HERE`}
          </pre>
        </div>

        {/* OAuth flow */}
        <div>
          <h3 className="mb-2 text-sm font-medium">OAuth (no API key needed)</h3>
          <p className="text-xs text-muted-foreground">
            Clients that support MCP OAuth discovery (RFC 9728) can connect
            without an API key. Point the client at <code>{mcpUrl}</code> and
            it will discover the Clerk authorization server automatically.
            You will see a consent screen in your browser.
          </p>
        </div>

        {/* Endpoint reference */}
        <div className="rounded-md border p-3">
          <h3 className="mb-1 text-sm font-medium">Endpoint Reference</h3>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="py-1 pr-3 text-muted-foreground">MCP URL</td>
                <td><code>{mcpUrl}</code></td>
              </tr>
              <tr>
                <td className="py-1 pr-3 text-muted-foreground">SSE URL</td>
                <td><code>{baseUrl}/api/mcp/sse</code></td>
              </tr>
              <tr>
                <td className="py-1 pr-3 text-muted-foreground">OAuth Metadata</td>
                <td><code>{baseUrl}/.well-known/oauth-protected-resource</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
