import "server-only";

/**
 * Direct PostgREST RPC caller for the x402 atomic insert functions
 * (register_wallet_atomic, connect_wallet_atomic). Those functions exist in
 * the live schema but not in database.types.ts (the file is hand-maintained
 * and updated separately by Drew), so the typed adminSupabase client cannot
 * call them. This wrapper centralizes the raw fetch, service-role auth
 * headers, timeout, and PostgREST error parsing that insertRegisterAtomic
 * and insertConnectAtomic previously duplicated.
 *
 * Called by: register/insertRegisterAtomic.ts, connect/insertConnectAtomic.ts
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE
 */

/** PostgREST error body fields needed by callers to map unique violations. */
export interface PostgrestRpcError {
  code: string | null;
  details: string;
  message: string;
}

export type CallPostgrestRpcResult =
  | { ok: true; row: unknown }
  | { ok: false; error: PostgrestRpcError };

const RPC_TIMEOUT_MS = 15_000;

export async function callPostgrestRpc(
  functionName: string,
  params: Record<string, unknown>
): Promise<CallPostgrestRpcResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      `[callPostgrestRpc] Missing Supabase env vars; cannot call ${functionName}.`
    );
    return {
      ok: false,
      error: { code: null, details: "", message: "Database not configured." },
    };
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/${functionName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      let body: { code?: string; details?: string; message?: string };
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text };
      }
      return {
        ok: false,
        error: {
          code: body.code ?? null,
          details: body.details ?? "",
          message: body.message ?? "RPC failed.",
        },
      };
    }

    return { ok: true, row: await response.json() };
  } catch (err) {
    console.error(
      `[callPostgrestRpc] ${functionName} threw:`,
      err instanceof Error ? err.message : err
    );
    return {
      ok: false,
      error: {
        code: null,
        details: "",
        message:
          err instanceof Error ? err.message : "Unexpected RPC error.",
      },
    };
  }
}
