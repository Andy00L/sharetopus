import "server-only";

import { randomUUID } from "node:crypto";
import { encodePaymentResponseHeader } from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { db, runQuery } from "@/db/client";
import { social_accounts, social_connections } from "@/db/schema";
import type { Json } from "@/db/schema";
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
  issueConnectionToken,
  loadConnectionTokenSecret,
} from "@/lib/x402/oauth/connectionToken";
import { generateOAuthState } from "@/lib/x402/oauth/state";
import {
  mapSettlePaymentError,
  mapVerifyPaymentError,
  type MappedSettleError,
  type MappedVerifyError,
} from "@/lib/x402/payment/errorMaps";
import { readActionPrice } from "@/lib/x402/pricing/readActionPrice";
import { buildOAuthUrl } from "./buildOAuthUrl";
import type { ConnectNetworkContext, ConnectSuccessPayload } from "./types";

const CONNECT_VERIFY_RATE_LIMIT = { limit: 5, windowSeconds: 60 };

export type ConnectVerifyResult =
  | {
      ok: true;
      payload: ConnectSuccessPayload;
      settleResponseHeader: string | null;
      principal: WalletPrincipal;
      chargeId: string | null;
    }
  | { ok: false; error: ConnectVerifyError; principal: WalletPrincipal | null; chargeId: string | null };

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

const ConnectSuccessPayloadSchema = z.object({
  connectionId: z.string(),
  platform: z.enum(POSTING_PLATFORMS),
  oauthUrl: z.string().nullable(),
  connectionToken: z.string().nullable(),
  expiresAt: z.string(),
  isReconnect: z.boolean(),
});

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

  const [rateLimitResult, priceResult] = await Promise.all([
    checkRateLimit({
      operation: "x402_connect_verify",
      identifier: null,
      rule: CONNECT_VERIFY_RATE_LIMIT,
    }),
    readActionPrice("connect_account"),
  ]);
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

  const tokenSecretResult = loadConnectionTokenSecret();
  if (!tokenSecretResult.ok) {
    console.error("[handleConnectVerify] X402_HMAC_SECRET not set; refusing to charge.");
    return failBeforeWallet({
      kind: "server_misconfiguration",
      message: "Connection tokens are not configured on the server.",
    });
  }
  const tokenSecret = tokenSecretResult.secret;

  const redirectUri = getOAuthRedirectUri(context.platform);
  if (!redirectUri) {
    console.error(`[handleConnectVerify] Redirect URI env not set for ${context.platform}; refusing to charge.`);
    return failBeforeWallet({
      kind: "server_misconfiguration",
      message: `OAuth redirect URI is not configured for ${context.platform}.`,
    });
  }

  if (!priceResult.ok) {
    return failBeforeWallet({ kind: "db_error", message: "Unable to read connect pricing from database." });
  }
  const connectPrice = priceResult.usdcPrice;

  const verifyResult = await verifyPayment({
    paymentHeader,
    amountUsdc: connectPrice,
    recipientAddress: context.recipientAddress,
    network: context.network,
  });
  if (!verifyResult.ok) {
    return failBeforeWallet(mapVerifyPaymentError(verifyResult.error));
  }

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
      .orderBy(sql`${social_accounts.token_expires_at} desc nulls first`)
      .limit(1),
  );

  if (existingError) {
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
      payload: buildReconnectPayload({ existingAccount, wallet, context, tokenSecret }),
      settleResponseHeader: null,
      principal: wallet,
      chargeId: null,
    };
  }

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
        return respondToConnectReplay(
          chargeResult.replay,
          wallet,
          verifyResult.payerAddress,
          context,
          verifyResult.requirements.amount,
        );
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

  const payload: ConnectSuccessPayload = {
    connectionId,
    platform: context.platform,
    oauthUrl: oauthResult.url,
    connectionToken: issueConnectionToken(tokenSecret, {
      connectionId,
      walletAddress: wallet.address,
      chargeId,
      iat: Date.now(),
      exp: new Date(expiresAt).getTime() + CONNECTION_TOKEN_GRACE_MS,
      platform: context.platform,
    }),
    expiresAt,
    isReconnect: false,
  };
  const recordWrite = await updateChargeRecord(chargeId, {
    socialConnectionId: connectionId,
    metadata: { result: payload },
  });
  if (!recordWrite.ok) {
    console.error(
      `[handleConnectVerify] CHARGE RECORD INCOMPLETE: charge ${chargeId} created connection ${connectionId} but the link and replay payload were not saved after a retry (${recordWrite.message}); a replay of this payment answers 409.`,
    );
  }

  return {
    ok: true,
    payload,
    settleResponseHeader: buildSettleResponseHeader({
      payerAddress: verifyResult.payerAddress,
      txHash,
      network: context.network,
      amountAtomic: verifyResult.requirements.amount,
    }),
    principal: wallet,
    chargeId,
  };
}

function buildReconnectPayload(params: {
  existingAccount: { id: string; token_expires_at: string | null; connection_id: string | null };
  wallet: WalletPrincipal;
  context: ConnectNetworkContext;
  tokenSecret: string;
}): ConnectSuccessPayload {
  const { existingAccount, wallet, context, tokenSecret } = params;
  const effectiveExpiryMs = existingAccount.token_expires_at
    ? new Date(existingAccount.token_expires_at).getTime()
    : Date.now();

  const reconnectToken = existingAccount.connection_id
    ? issueConnectionToken(tokenSecret, {
        connectionId: existingAccount.connection_id,
        walletAddress: wallet.address,
        chargeId: null,
        iat: Date.now(),
        exp: effectiveExpiryMs + CONNECTION_TOKEN_GRACE_MS,
        platform: context.platform,
      })
    : null;

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
  amountAtomic: string;
}): string {
  const settleResponse: SettleResponse = {
    success: true,
    payer: params.payerAddress,
    transaction: params.txHash,
    network: params.network.caipNetwork,
    amount: params.amountAtomic,
  };
  return encodePaymentResponseHeader(settleResponse);
}

function respondToConnectReplay(
  replay: ChargeReplay,
  wallet: WalletPrincipal,
  payerAddress: string,
  context: ConnectNetworkContext,
  amountAtomic: string,
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
          amountAtomic,
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
