import "server-only";

import { randomUUID } from "node:crypto";
import { encodePaymentResponseHeader } from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { db, runQuery } from "@/db/client";
import { social_accounts, social_connections } from "@/db/schema";
import type { Json } from "@/lib/types/database.types";
import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";
import { resolveOrOnboardWalletPrincipal } from "@/lib/x402/auth/resolveOrOnboardWalletPrincipal";
import type { WalletPrincipal } from "@/lib/x402/auth/types";
import {
  refundCharge,
  settleCharge,
  updateChargeRecord,
  type ChargeReplay,
} from "@/lib/x402/charges/chargeLifecycle";
import {
  CONNECTION_TOKEN_GRACE_MS,
  OAUTH_EXPIRY_MINUTES,
  getOAuthRedirectUri,
} from "@/lib/x402/config";
import { verifyPayment } from "@/lib/x402/facilitator";
import { describeRateLimitRejection } from "@/lib/x402/http/rateLimitRejection";
import type { NetworkConfig } from "@/lib/x402/networks";
import {
  hasConnectionTokenSecret,
  issueConnectionToken,
} from "@/lib/x402/oauth/connectionToken";
import { generateOAuthState } from "@/lib/x402/oauth/state";
import {
  mapSettlePaymentError,
  mapVerifyPaymentError,
  type MappedSettleError,
  type MappedVerifyError,
} from "@/lib/x402/payment/errorMaps";
import { readActionPrice } from "@/lib/x402/pricing/readActionPrice";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";
import { buildOAuthUrl } from "./buildOAuthUrl";
import type { ConnectNetworkContext, ConnectSuccessPayload } from "./types";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ConnectVerifyResult =
  | {
      ok: true;
      payload: ConnectSuccessPayload;
      settleResponseHeader: string | null;
      /** Resolved wallet, for the route's audit logging. */
      principal: WalletPrincipal;
      /** Charge created by this call; null on idempotent reconnects. */
      chargeId: string | null;
    }
  | { ok: false; error: ConnectVerifyError; principal: WalletPrincipal | null; chargeId: string | null };

/**
 * Every error variant the connect verify flow can produce. The verify and
 * settle members come from the shared facilitator error mapping in
 * payment/errorMaps.ts.
 */
export type ConnectVerifyError =
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "rate_limiter_unavailable"; message: string; retryAfterSeconds: number }
  | { kind: "wallet_sanctioned"; message: string }
  | { kind: "db_error"; message: string }
  | { kind: "server_misconfiguration"; message: string }
  | { kind: "payment_in_progress"; message: string }
  | { kind: "settlement_unrecorded"; message: string }
  | MappedVerifyError
  | MappedSettleError
  | {
      kind: "db_insert_failed";
      message: string;
      refundInitiated: boolean;
      refundTxHash: string | null;
    };

/** Shape of a stored connect result, re-read on replay. */
const ConnectSuccessPayloadSchema = z.object({
  connectionId: z.string(),
  platform: z.enum(POSTING_PLATFORMS),
  oauthUrl: z.string().nullable(),
  connectionToken: z.string().nullable(),
  expiresAt: z.string(),
  isReconnect: z.boolean(),
});

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Full /connect verify flow. Called when a payment header is present.
 *
 * Flow:
 *   1. Rate limit check (x402_connect_verify, 5/min per IP)
 *   2. Fail fast on missing server config (HMAC secret, redirect URI) so
 *      nothing can fail AFTER the wallet has been charged
 *   3. Read connect pricing (verifyPayment needs the expected amount)
 *   4. verifyPayment (off-chain): proves the caller controls the paying key
 *   5. Resolve or onboard the wallet from the facilitator-recovered payer;
 *      sanctioned wallets are rejected, nothing has settled yet
 *   6. Reconnect check: a healthy existing connection costs nothing (the
 *      verified payment is never settled; its authorization expires unclaimed)
 *   7. Build the OAuth URL (env-only and pure, so still before settle)
 *   8. settleCharge: pending charge row first, then settle, then settled.
 *      A replay of the same payment gets its stored result back.
 *   9. Insert the social_connections row (with the PKCE verifier); if that
 *      fails after settlement, refund through the charge lifecycle
 *  10. Issue the HMAC connection token and store the result for replay
 */
export async function handleConnectVerify(
  paymentHeader: string,
  context: ConnectNetworkContext,
): Promise<ConnectVerifyResult> {
  const failBeforeWallet = (error: ConnectVerifyError): ConnectVerifyResult => ({
    ok: false,
    error,
    principal: null,
    chargeId: null,
  });

  // -- 1. Rate limit
  const rateLimitResult = await checkRateLimit("x402_connect_verify", null, 5, 60);
  if (!rateLimitResult.success) {
    const rejection = describeRateLimitRejection(rateLimitResult);
    return failBeforeWallet(
      rejection.errorKind === "rate_limiter_unavailable"
        ? {
            kind: "rate_limiter_unavailable",
            message: rejection.message,
            retryAfterSeconds: rejection.retryAfterSeconds,
          }
        : { kind: "rate_limited", retryAfterSeconds: rejection.retryAfterSeconds },
    );
  }

  // -- 2. Fail fast on server misconfiguration, BEFORE any charge
  if (!hasConnectionTokenSecret()) {
    console.error("[handleConnectVerify] X402_HMAC_SECRET not set; refusing to charge.");
    return failBeforeWallet({
      kind: "server_misconfiguration",
      message: "Connection tokens are not configured on the server.",
    });
  }

  const redirectUri = getOAuthRedirectUri(context.platform);
  if (!redirectUri) {
    console.error(`[handleConnectVerify] Redirect URI env not set for ${context.platform}; refusing to charge.`);
    return failBeforeWallet({
      kind: "server_misconfiguration",
      message: `OAuth redirect URI is not configured for ${context.platform}.`,
    });
  }

  // -- 3. Connect pricing
  const priceResult = await readActionPrice("connect_account");
  if (!priceResult.ok) {
    return failBeforeWallet({ kind: "db_error", message: "Unable to read connect pricing from database." });
  }
  const connectPrice = priceResult.usdcPrice;

  // -- 4. Verify (off-chain)
  const verifyResult = await verifyPayment({
    paymentHeader,
    amountUsdc: connectPrice,
    recipientAddress: context.recipientAddress,
    network: context.network,
  });
  if (!verifyResult.ok) {
    return failBeforeWallet(mapVerifyPaymentError(verifyResult.error));
  }

  // -- 5. Resolve or onboard the wallet. Sanctioned wallets are rejected
  //       before the reconnect check so a wallet flagged after onboarding
  //       cannot keep using even the free path.
  const walletResult = await resolveOrOnboardWalletPrincipal({
    payerAddress: verifyResult.payerAddress,
    network: context.network,
  });
  if (!walletResult.ok) {
    if (walletResult.reason === "sanctioned") {
      return {
        ok: false,
        error: { kind: "wallet_sanctioned", message: walletResult.message },
        principal: walletResult.principal,
        chargeId: null,
      };
    }
    return failBeforeWallet({ kind: "db_error", message: walletResult.message });
  }
  const wallet = walletResult.principal;

  // -- 6. Reconnect check: healthy connection = no charge. Ordered and
  //       limited so a wallet with several healthy accounts on the platform
  //       deterministically reuses the freshest one. A null expiry means a
  //       non-expiring token (Facebook Page tokens) and counts as healthy;
  //       DESC ordering puts nulls first, so those win deterministically.
  const nowIso = new Date().toISOString();
  const { data: existingAccounts, error: existingError } = await runQuery(
    db
      .select({
        id: social_accounts.id,
        token_expires_at: social_accounts.token_expires_at,
        connection_id: social_accounts.connection_id,
      })
      .from(social_accounts)
      .where(
        and(
          eq(social_accounts.principal_id, wallet.principalId),
          eq(social_accounts.platform, context.platform),
          isNull(social_accounts.deleted_at),
          or(gt(social_accounts.token_expires_at, nowIso), isNull(social_accounts.token_expires_at)),
        ),
      )
      .orderBy(desc(social_accounts.token_expires_at))
      .limit(1),
  );

  if (existingError) {
    // Fail closed: charging a wallet that may own a healthy connection
    // would be an accidental double-charge.
    console.error(`[handleConnectVerify] Reconnect lookup failed: ${existingError.message}`);
    return {
      ok: false,
      error: { kind: "db_error", message: "Failed to check for an existing connection." },
      principal: wallet,
      chargeId: null,
    };
  }

  const existingAccount = existingAccounts[0];
  if (existingAccount) {
    console.log(
      `[handleConnectVerify] Wallet ${wallet.principalId} already has a healthy ${context.platform} connection. Returning idempotent.`,
    );
    return {
      ok: true,
      payload: buildReconnectPayload(existingAccount, wallet, context),
      settleResponseHeader: null,
      principal: wallet,
      chargeId: null,
    };
  }

  // -- 7. Connection details + OAuth URL, still before settle: a missing
  //       platform client id rejects here with nothing charged.
  const connectionId = randomUUID();
  const oauthState = generateOAuthState();
  const expiresAt = new Date(Date.now() + OAUTH_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const oauthResult = buildOAuthUrl({
    platform: context.platform,
    state: oauthState,
    redirectUri,
  });
  if (!oauthResult.ok) {
    console.error(`[handleConnectVerify] OAuth URL build failed before settle; refusing to charge: ${oauthResult.message}`);
    return {
      ok: false,
      error: { kind: "server_misconfiguration", message: oauthResult.message },
      principal: wallet,
      chargeId: null,
    };
  }

  // -- 8. Record, settle, finalize.
  const chargeResult = await settleCharge({
    paymentHeader,
    network: context.network,
    verified: verifyResult,
    principal: wallet,
    action: "connect_account",
    amountUsdc: connectPrice,
    requestId: randomUUID(),
    recipientAddress: context.recipientAddress,
  });

  if (!chargeResult.ok) {
    switch (chargeResult.reason) {
      case "replay":
        return respondToConnectReplay(chargeResult.replay, wallet, verifyResult.payerAddress, context, connectPrice);
      case "charge_insert_failed":
        return {
          ok: false,
          error: { kind: "db_error", message: `${chargeResult.message} No payment was taken.` },
          principal: wallet,
          chargeId: null,
        };
      case "settle_failed":
        return {
          ok: false,
          error: mapSettlePaymentError(chargeResult.error),
          principal: wallet,
          chargeId: chargeResult.chargeId,
        };
      case "settled_unrecorded":
        return {
          ok: false,
          error: {
            kind: "settlement_unrecorded",
            message:
              "Payment settled but could not be recorded. It is queued for reconciliation; do not retry this payment.",
          },
          principal: wallet,
          chargeId: chargeResult.chargeId,
        };
      default: {
        const unhandledResult: never = chargeResult;
        console.error(`[handleConnectVerify] Unhandled charge result: ${JSON.stringify(unhandledResult)}`);
        return failBeforeWallet({ kind: "db_error", message: "Internal payment-state error." });
      }
    }
  }
  const { chargeId, txHash } = chargeResult;

  // -- 9. The connection row. The PKCE verifier (X) is written with it, so no
  //       callback can arrive before it exists.
  const { error: insertError } = await runQuery(
    db.insert(social_connections).values({
      id: connectionId,
      principal_id: wallet.principalId,
      initiated_via: "x402",
      initiated_x402_charge_id: chargeId,
      platform: context.platform,
      oauth_state: oauthState,
      oauth_code_verifier: oauthResult.codeVerifier,
      redirect_uri: redirectUri,
      status: "pending",
      expires_at: expiresAt,
    }),
  );

  if (insertError) {
    console.error(
      `[handleConnectVerify] Connection insert failed after settle (charge ${chargeId}, tx ${txHash}). Initiating refund. Error: ${insertError.message}`,
    );
    const refundOutcome = await refundCharge({
      chargeId,
      settleTxHash: txHash,
      payerAddress: verifyResult.payerAddress,
      amountUsdc: connectPrice,
      network: context.network,
      reason: "db_insert_failed_post_settle_connect",
      principalId: wallet.principalId,
    });
    return {
      ok: false,
      error: {
        kind: "db_insert_failed",
        message: "Failed to create the connection record after settlement.",
        refundInitiated: refundOutcome.refundInitiated,
        refundTxHash: refundOutcome.refundTxHash,
      },
      principal: wallet,
      chargeId,
    };
  }

  // -- 10. Connection token. The secret was checked before any charge, so
  //        this cannot fail here; the branch satisfies the result type.
  const tokenResult = issueConnectionToken({
    connectionId,
    walletAddress: wallet.address,
    chargeId,
    iat: Date.now(),
    exp: new Date(expiresAt).getTime() + CONNECTION_TOKEN_GRACE_MS,
    platform: context.platform,
  });
  if (!tokenResult.ok) {
    console.error("[handleConnectVerify] Token issuance failed after pre-check passed; connection is unpollable.");
  }

  const payload: ConnectSuccessPayload = {
    connectionId,
    platform: context.platform,
    oauthUrl: oauthResult.url,
    connectionToken: tokenResult.ok ? tokenResult.token : null,
    expiresAt,
    isReconnect: false,
  };
  await updateChargeRecord(chargeId, {
    socialConnectionId: connectionId,
    metadata: { result: payload },
  });

  return {
    ok: true,
    payload,
    settleResponseHeader: buildSettleResponseHeader({
      payerAddress: verifyResult.payerAddress,
      txHash,
      network: context.network,
      amountUsdc: connectPrice,
    }),
    principal: wallet,
    chargeId,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReconnectPayload(
  existingAccount: { id: string; token_expires_at: string | null; connection_id: string | null },
  wallet: WalletPrincipal,
  context: ConnectNetworkContext,
): ConnectSuccessPayload {
  // Non-expiring tokens (null expiry) get a synthetic expiry of now plus
  // the grace period for the polling token and the payload field.
  const effectiveExpiryMs = existingAccount.token_expires_at
    ? new Date(existingAccount.token_expires_at).getTime()
    : Date.now();

  // Accounts created before connection tracking have no social_connections
  // row, so there is nothing for /oauth/status to poll: no token then.
  let reconnectToken: string | null = null;
  if (existingAccount.connection_id) {
    const tokenResult = issueConnectionToken({
      connectionId: existingAccount.connection_id,
      walletAddress: wallet.address,
      chargeId: null,
      iat: Date.now(),
      exp: effectiveExpiryMs + CONNECTION_TOKEN_GRACE_MS,
      platform: context.platform,
    });
    reconnectToken = tokenResult.ok ? tokenResult.token : null;
  }

  return {
    connectionId: existingAccount.connection_id ?? existingAccount.id,
    platform: context.platform,
    oauthUrl: null,
    connectionToken: reconnectToken,
    expiresAt:
      existingAccount.token_expires_at ??
      new Date(effectiveExpiryMs + CONNECTION_TOKEN_GRACE_MS).toISOString(),
    isReconnect: true,
  };
}

function buildSettleResponseHeader(params: {
  payerAddress: string;
  txHash: string;
  network: NetworkConfig;
  amountUsdc: number;
}): string {
  const settleResponse: SettleResponse = {
    success: true,
    payer: params.payerAddress,
    transaction: params.txHash,
    network: params.network.caipNetwork,
    amount: usdcToAtomic(params.amountUsdc, params.network.usdcDecimals),
  };
  return encodePaymentResponseHeader(settleResponse);
}

/** Answers a connect payment that was already presented. Charges nothing. */
function respondToConnectReplay(
  replay: ChargeReplay,
  wallet: WalletPrincipal,
  payerAddress: string,
  context: ConnectNetworkContext,
  connectPrice: number,
): ConnectVerifyResult {
  switch (replay.state) {
    case "in_progress":
      return {
        ok: false,
        error: {
          kind: "payment_in_progress",
          message: "This payment is still being processed. Retry the same request in a few seconds.",
        },
        principal: wallet,
        chargeId: replay.chargeId,
      };
    case "closed":
      return {
        ok: false,
        error: { kind: "verify_replay_detected", message: "This payment has already been used." },
        principal: wallet,
        chargeId: replay.chargeId,
      };
    case "settled": {
      const storedPayload = parseStoredPayload(replay.storedResult);
      if (!storedPayload) {
        return {
          ok: false,
          error: {
            kind: "verify_replay_detected",
            message: "This payment was already used and its result is not stored for replay.",
          },
          principal: wallet,
          chargeId: replay.chargeId,
        };
      }
      return {
        ok: true,
        payload: storedPayload,
        settleResponseHeader: buildSettleResponseHeader({
          payerAddress,
          txHash: replay.txHash,
          network: context.network,
          amountUsdc: connectPrice,
        }),
        principal: wallet,
        chargeId: replay.chargeId,
      };
    }
    default: {
      const unhandledReplay: never = replay;
      console.error(`[respondToConnectReplay] Unhandled replay state: ${JSON.stringify(unhandledReplay)}`);
      return {
        ok: false,
        error: { kind: "verify_replay_detected", message: "This payment has already been used." },
        principal: wallet,
        chargeId: null,
      };
    }
  }
}

function parseStoredPayload(storedResult: Json | null): ConnectSuccessPayload | null {
  const parsed = ConnectSuccessPayloadSchema.safeParse(storedResult);
  return parsed.success ? parsed.data : null;
}
