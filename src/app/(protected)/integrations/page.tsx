import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { listApiKeys } from "@/actions/server/api/apiKeys";
import { InactiveSubscriptionNotice } from "@/components/InactiveSubscriptionNotice";
import { ApiKeysCard } from "@/components/integrations/ApiKeysCard";
import { McpDocsCard } from "@/components/integrations/McpDocsCard";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";

function IntegrationsPageShell({ children }: { readonly children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <SidebarContent className="px-4 py-6">
        <SidebarGroup className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
            <p className="text-muted-foreground">
              Connect AI assistants and custom applications to Sharetopus.
            </p>
          </div>
        </SidebarGroup>
      </SidebarContent>
      {children}
    </div>
  );
}

async function IntegrationsForSubscriber() {
  const { userId } = await auth();

  const sub = await checkActiveSubscription(userId ?? null);
  if (!sub.isActive) {
    return <InactiveSubscriptionNotice status={sub.status} />;
  }

  const keysResult = await listApiKeys();

  return (
    <IntegrationsPageShell>
      {keysResult.success ? (
        <>
          <ApiKeysCard kind="mcp" initialKeys={keysResult.keysByKind.mcp} />
          <ApiKeysCard kind="rest" initialKeys={keysResult.keysByKind.rest} />
        </>
      ) : (
        <p className="px-4 text-sm text-destructive">
          {keysResult.message} Reload the page to try again.
        </p>
      )}
      <McpDocsCard />
    </IntegrationsPageShell>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<IntegrationsPageShell />}>
      <IntegrationsForSubscriber />
    </Suspense>
  );
}
