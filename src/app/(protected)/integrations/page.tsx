import { auth } from "@clerk/nextjs/server";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { listApiKeys } from "@/actions/server/mcp/listApiKeys";
import { SubscriptionPrompt } from "@/components/SubscriptionPrompt";
import { ApiKeysCard } from "./components/ApiKeysCard";
import { McpDocsCard } from "./components/McpDocsCard";

/**
 * Integrations page for managing MCP API keys and viewing connection docs.
 *
 * Server component. Checks for an active subscription before rendering
 * the key management UI. Free users see a SubscriptionPrompt instead,
 * matching the pattern in src/app/(protected)/connections/page.tsx.
 *
 * Route: /integrations (protected)
 * Server actions used: checkActiveSubscription, listApiKeys
 */
export default async function IntegrationsPage() {
  const { userId } = await auth();

  const sub = await checkActiveSubscription(userId ?? null);
  if (!sub.isActive) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Connect AI assistants to Sharetopus via the Model Context Protocol.
          </p>
        </div>
        <SubscriptionPrompt />
      </div>
    );
  }

  const keysResult = await listApiKeys(userId ?? null);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect AI assistants to Sharetopus via the Model Context Protocol.
        </p>
      </div>

      <ApiKeysCard initialKeys={keysResult.data ?? []} />
      <McpDocsCard />
    </div>
  );
}
