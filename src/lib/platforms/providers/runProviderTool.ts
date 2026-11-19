import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";

import { resolveConfiguredProvider } from "./registry";
import type { ProviderTool, ProviderToolResult } from "./types";

export type ToolDiscoveryResult =
  | {
      ok: true;
      providerId: string;
      providerLabel: string;
      tools: readonly ProviderTool[];
    }
  | {
      ok: false;
      reason: "account_not_found" | "provider_unavailable";
      message: string;
    };

export async function listProviderToolsForAccount(params: {
  principalId: string;
  socialAccountId: string;
}): Promise<ToolDiscoveryResult> {
  const account = await loadOwnedAccount(params);
  if (!account.ok) {
    return {
      ok: false,
      reason: "account_not_found",
      message: "Connection not found.",
    };
  }

  const providerResult = resolveConfiguredProvider(account.platform);
  if (!providerResult.ok) {
    if (providerResult.reason === "unknown_provider") {
      return {
        ok: true,
        providerId: account.platform,
        providerLabel: account.platform,
        tools: [],
      };
    }
    return {
      ok: false,
      reason: "provider_unavailable",
      message: providerResult.message,
    };
  }

  return {
    ok: true,
    providerId: providerResult.provider.id,
    providerLabel: providerResult.provider.label,
    tools: providerResult.provider.tools,
  };
}

export type RunToolResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      reason:
        | "account_not_found"
        | "provider_unavailable"
        | "unknown_tool"
        | "missing_parameter"
        | "no_credential"
        | "tool_failed";
      message: string;
    };

export async function runProviderToolForAccount(params: {
  principalId: string;
  socialAccountId: string;
  methodName: string;
  parameters: Record<string, unknown>;
}): Promise<RunToolResult> {
  const account = await loadOwnedAccount(params);
  if (!account.ok) {
    return {
      ok: false,
      reason: "account_not_found",
      message: "Connection not found.",
    };
  }

  const providerResult = resolveConfiguredProvider(account.platform);
  if (!providerResult.ok) {
    return {
      ok: false,
      reason: "provider_unavailable",
      message: providerResult.message,
    };
  }
  const provider = providerResult.provider;

  const declaredTool = provider.tools.find(
    (tool) => tool.methodName === params.methodName,
  );
  if (!declaredTool || !provider.runTool) {
    return {
      ok: false,
      reason: "unknown_tool",
      message: `${provider.label} has no tool named "${params.methodName}".`,
    };
  }

  for (const declaredParameter of declaredTool.parameters) {
    if (!declaredParameter.required) continue;
    const suppliedValue = params.parameters[declaredParameter.name];
    if (suppliedValue === undefined || suppliedValue === null) {
      return {
        ok: false,
        reason: "missing_parameter",
        message: `Parameter "${declaredParameter.name}" is required.`,
      };
    }
  }

  if (!account.accessToken) {
    return {
      ok: false,
      reason: "no_credential",
      message: "That connection has no stored credential. Reconnect it.",
    };
  }

  let toolResult: ProviderToolResult;
  try {
    toolResult = await provider.runTool({
      methodName: params.methodName,
      accessToken: account.accessToken,
      config: account.config,
      parameters: params.parameters,
    });
  } catch (toolError) {
    console.error(
      `[runProviderToolForAccount] ${provider.id}.${params.methodName} threw:`,
      toolError instanceof Error ? toolError.message : toolError,
    );
    return {
      ok: false,
      reason: "tool_failed",
      message: "The provider tool failed unexpectedly.",
    };
  }

  if (!toolResult.ok) {
    return { ok: false, reason: "tool_failed", message: toolResult.message };
  }

  return { ok: true, data: toolResult.data };
}

type OwnedAccount =
  | {
      ok: true;
      platform: string;
      accessToken: string | null;
      config: Record<string, unknown>;
    }
  | { ok: false };

async function loadOwnedAccount(params: {
  principalId: string;
  socialAccountId: string;
}): Promise<OwnedAccount> {
  const { data: accountRows, error: lookupError } = await runQuery(
    db
      .select({
        platform: social_accounts.platform,
        access_token: social_accounts.access_token,
        extra: social_accounts.extra,
      })
      .from(social_accounts)
      .where(
        and(
          eq(social_accounts.id, params.socialAccountId),
          eq(social_accounts.principal_id, params.principalId),
          isNull(social_accounts.deleted_at),
        ),
      )
      .limit(1),
  );

  if (lookupError) {
    console.error(
      "[runProviderTool.loadOwnedAccount] Lookup failed:",
      lookupError.message,
    );
    return { ok: false };
  }
  const accountRow = accountRows[0];
  if (!accountRow) return { ok: false };

  const rawExtra = accountRow.extra;
  const config: Record<string, unknown> =
    rawExtra !== null && typeof rawExtra === "object" && !Array.isArray(rawExtra)
      ? rawExtra
      : {};

  return {
    ok: true,
    platform: accountRow.platform,
    accessToken: accountRow.access_token,
    config,
  };
}
