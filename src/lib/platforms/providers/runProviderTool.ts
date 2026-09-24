import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";

import { resolveConfiguredProvider } from "./registry";
import type { ProviderTool, ProviderToolResult } from "./types";

/**
 * Runs a provider helper tool against one connected account.
 *
 * This is the single generic entry point behind both the REST trigger
 * route and the MCP tool, so a provider that declares a new helper needs
 * no new route, no new schema, and no new MCP registration. It replaces
 * what would otherwise be one bespoke endpoint per helper (list Discord
 * channels, fetch Reddit flairs, list LinkedIn pages, search Reels audio).
 *
 * Authorization: the account is looked up scoped to the calling principal,
 * so an account id belonging to someone else resolves to nothing and is
 * reported as not found rather than as forbidden. Callers never pass a
 * token in; it is read from the row here so a credential cannot be
 * supplied or substituted by the request.
 *
 * Called by: /api/v1/connections/[id]/tools (GET and POST).
 * Tables touched: social_accounts (read).
 */

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

/**
 * Lists the helper tools available on a connection, with their parameter
 * schemas. This is the discovery half: an agent calls it first to learn
 * what it can trigger.
 */
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
    // The seven legacy platforms (linkedin, tiktok, ...) are not in the
    // registry, so an unknown provider here is a valid connection that
    // simply has no registry tools. That is an empty list, not an error;
    // agents iterate every connection and a 500 would page for nothing.
    // A registry provider whose env is unset stays an error, because its
    // declared tools exist and are unavailable for an operator reason.
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

/**
 * Executes one helper tool. Validates the method name and required
 * parameters against the provider's own declaration before calling it, so
 * a provider implementation never has to re-check the basics.
 */
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

  // Validate against the provider's own parameter declaration so every
  // provider gets the same guarantees without repeating the checks.
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
    // Providers are contracted to return errors as values. A throw is a bug
    // in the provider, not a caller error, so it is logged and flattened.
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

/**
 * Loads a connected account scoped to its owner. The principal filter is
 * the authorization check: a row belonging to anyone else simply does not
 * come back, so existence is never disclosed.
 */
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

  // extra is Json; narrow to a plain object so provider config reads are
  // typed without an assertion. A non-object value degrades to {} rather
  // than throwing inside a provider.
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
