import "server-only";

import { randomUUID } from "node:crypto";
import {
  decodePaymentSignatureHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { adminSupabase } from "@/actions/api/adminSupabase";
import {
  verifyPayment,
  settlePayment,
  refundPayment,
} from "@/lib/x402/facilitator";
import {
  CONNECTION_TOKEN_GRACE_MS,
  FACILITATOR_NAME,
  OAUTH_EXPIRY_MINUTES,
  getOAuthRedirectUri,
} from "@/lib/x402/config";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";
import { readActionPrice } from "@/lib/x402/pricing/readActionPrice";
import {
  mapVerifyPaymentError,
  mapSettlePaymentError,
} from "@/lib/x402/payment/errorMaps";
import type {
  MappedVerifyError,
  MappedSettleError,
} from "@/lib/x402/payment/errorMaps";
import { extractPayerAddress } from "@/lib/x402/payment/paymentPayload";
import { resolveWalletPrincipal } from "@/lib/x402/auth/resolveWalletPrincipal";
import type { WalletPrincipal } from "@/lib/x402/auth/types";
import { applyWalletGate } from "@/lib/x402/sanctions/applyWalletGate";
import {
  hasConnectionTokenSecret,
  issueConnectionToken,
} from "@/lib/x402/oauth/connectionToken";
import { generateOAuthState } from "@/lib/x402/oauth/state";
import { buildOAuthUrl } from "./buildOAuthUrl";
import { insertConnectAtomic } from "./insertConnectAtomic";
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
  | { ok: false; error: ConnectVerifyError };

/**
 * Every error variant the connect verify flow can produce. The verify and
 * settle members come from the shared facilitator error mapping in
 * payment/errorMaps.ts.
 */
export type ConnectVerifyError =
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "wallet_not_registered"; message: string }
  | { kind: "wallet_sanctioned"; message: string }
  | { kind: "db_error"; message: string }
  | { kind: "server_misconfiguration"; message: string }
  | MappedVerifyError
  | MappedSettleError
  | {
      kind: "db_insert_failed";
      message: string;
      refundInitiated: boolean;
      refundTxHash: string | null;
    };

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
 *   3. Decode payment header, extract payer address, resolve wallet
 *   4. Sanctions gate (applyWalletGate); also covers the free reconnect path
 *   5. Reconnect check: a healthy existing connection costs nothing
 *   6. Read connect pricing, verifyPayment (facilitator + KYT), settlePayment
 *   7. Generate connectionId / oauth_state, build the OAuth URL
 *   8. insertConnectAtomic (connect_wallet_atomic RPC)
 *   9. If the DB insert fails post-settle: refundPayment, report whether the
 *      refund actually succeeded
 *  10. Issue the HMAC connection token for /oauth/status polling
 *
 * Residual risk (accepted at the June 2026 checkpoint, Phase 4.4 item): the
 * atomic RPC inserts after settle, so a process crash between settle and
 * insert leaves a settled payment with no DB row.
 */
export async function handleConnectVerify(
  paymentHeader: string,
  context: ConnectNetworkContext
): Promise<ConnectVerifyResult> {
  // -- 1. Rate limit
  const rateLimitResult = await checkRateLimit(
    "x402_connect_verify",
    null,
    5,
    60
  );
  if (!rateLimitResult.success) {
    return {
      ok: false,
      error: {
        kind: "rate_limited",
        retryAfterSeconds: rateLimitResult.resetIn ?? 60,
      },
    };
  }

  // -- 2. Fail fast on server misconfiguration, BEFORE any charge
  if (!hasConnectionTokenSecret()) {
    console.error("[handleConnectVerify] X402_HMAC_SECRET not set; refusing to charge.");
    return {
      ok: false,
      error: {
        kind: "server_misconfiguration",
        message: "Connection tokens are not configured on the server.",
      },
    };
  }

  const redirectUri = getOAuthRedirectUri(context.platform);
  if (!redirectUri) {
    console.error(`[handleConnectVerify] Redirect URI env not set for ${context.platform}; refusing to charge.`);
    return {
      ok: false,
      error: {
        kind: "server_misconfiguration",
        message: `OAuth redirect URI is not configured for ${context.platform}.`,
      },
    };
  }

  // -- 3. Decode payment header, extract payer, resolve wallet
  let payerAddress: string | null = null;
  try {
    payerAddress = extractPayerAddress(
      decodePaymentSignatureHeader(paymentHeader)
    );
  } catch (err) {
    console.error("[handleConnectVerify] Failed to decode payment header:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "malformed_payment",
        message: "Payment header is not valid base64-encoded JSON.",
      },
    };
  }

  if (!payerAddress) {
    return {
      ok: false,
      error: {
        kind: "malformed_payment",
        message: "Payment payload is missing the payer address.",
      },
    };
  }

  const walletResult = await resolveWalletPrincipal(payerAddress);
  if (!walletResult.ok) {
    return {
      ok: false,
      error: {
        kind: "wallet_not_registered",
        message: walletResult.message,
      },
    };
  }
  const wallet = walletResult.principal;

  // -- 4. Sanctions gate. Runs before the reconnect check so a wallet
  //       flagged after registration cannot keep using even the free path.
  const gateResult = await applyWalletGate(wallet.walletId);
  if (!gateResult.allowed) {
    return {
      ok: false,
      error: {
        kind: "wallet_sanctioned",
        message: `Wallet access denied: ${gateResult.reason}.`,
      },
    };
  }

  // -- 5. Reconnect check: healthy connection = no charge. Ordered and
  //       limited so a wallet with several healthy accounts on the platform
  //       deterministically reuses the freshest one.
  const nowIso = new Date().toISOString();
  const { data: existingAccounts, error: existingError } = await adminSupabase
    .from("social_accounts")
    .select("id, account_identifier, token_expires_at, connection_id")
    .eq("principal_id", wallet.principalId)
    .eq("platform", context.platform)
    .is("deleted_at", null)
    .gt("token_expires_at", nowIso)
    .order("token_expires_at", { ascending: false })
    .limit(1);

  if (existingError) {
    // Fail closed: charging a wallet that may own a healthy connection
    // would be an accidental double-charge.
    console.error(`[handleConnectVerify] Reconnect lookup failed: ${existingError.message}`);
    return {
      ok: false,
      error: {
        kind: "db_error",
        message: "Failed to check for an existing connection.",
      },
    };
  }

  const existingAccount = existingAccounts?.[0];
  if (existingAccount && existingAccount.token_expires_at) {
    console.log(`[handleConnectVerify] Wallet ${wallet.principalId} already has a healthy ${context.platform} connection. Returning idempotent.`);

    // Accounts created before connection tracking have no social_connections
    // row, so there is nothing for /oauth/status to poll: no token then.
    let reconnectToken: string | null = null;
    if (existingAccount.connection_id) {
      const tokenResult = issueConnectionToken({
        connectionId: existingAccount.connection_id,
        walletAddress: wallet.address,
        chargeId: null,
        iat: Date.now(),
        exp:
          new Date(existingAccount.token_expires_at).getTime() +
          CONNECTION_TOKEN_GRACE_MS,
        platform: context.platform,
      });
      reconnectToken = tokenResult.ok ? tokenResult.token : null;
    }

    return {
      ok: true,
      payload: {
        connectionId: existingAccount.connection_id ?? existingAccount.id,
        platform: context.platform,
        oauthUrl: null,
        connectionToken: reconnectToken,
        expiresAt: existingAccount.token_expires_at,
        isReconnect: true,
      },
      settleResponseHeader: null,
      principal: wallet,
      chargeId: null,
    };
  }

  // -- 6a. Read connect pricing
  const priceResult = await readActionPrice("connect_account");
  if (priceResult.ok === false) {
    return {
      ok: false,
      error: {
        kind: "db_error",
        message: "Unable to read connect pricing from database.",
      },
    };
  }
  const connectPrice = priceResult.usdcPrice;

  // -- 6b. Verify payment (facilitator + KYT)
  const verifyResult = await verifyPayment({
    paymentHeader,
    resourceUrl: context.resourceUrl,
    amountUsdc: connectPrice,
    recipientAddress: context.recipientAddress,
    network: context.network,
  });

  if (!verifyResult.ok) {
    return { ok: false, error: mapVerifyPaymentError(verifyResult.error) };
  }

  // -- 6c. Settle payment
  const settleResult = await settlePayment({
    paymentHeader,
    network: context.network,
  });

  if (!settleResult.ok) {
    return { ok: false, error: mapSettlePaymentError(settleResult.error) };
  }

  // -- 7. Generate connection details + build OAuth URL
  const connectionId = randomUUID();
  const oauthState = generateOAuthState();
  const expiresAt = new Date(
    Date.now() + OAUTH_EXPIRY_MINUTES * 60 * 1000
  ).toISOString();

  const oauthResult = buildOAuthUrl({
    platform: context.platform,
    state: oauthState,
    redirectUri,
  });

  if (!oauthResult.ok) {
    // Money already settled; this failure must go through the refundable
    // db_insert_failed shape so the caller learns whether they were repaid.
    console.error(`[handleConnectVerify] OAuth URL build failed after settle: ${oauthResult.message}`);
    const refundResult = await refundPayment({
      originalTxHash: settleResult.txHash,
      payerAddress: verifyResult.payerAddress,
      amountUsdc: verifyResult.chargeAmountUsdc,
      network: context.network,
      reason: "oauth_url_build_failed_post_settle",
    });
    return {
      ok: false,
      error: {
        kind: "db_insert_failed",
        message: oauthResult.message,
        refundInitiated: refundResult.ok,
        refundTxHash: refundResult.ok ? refundResult.refundTxHash : null,
      },
    };
  }

  // -- 8. Build the settlement response header
  const settleResponse: SettleResponse = {
    success: true,
    payer: verifyResult.payerAddress,
    transaction: settleResult.txHash,
    network: context.network.caipNetwork as `${string}:${string}`,
    amount: usdcToAtomic(connectPrice, context.network.usdcDecimals),
  };
  const settleResponseHeader = encodePaymentResponseHeader(settleResponse);

  // -- 9. Atomic DB insert. network/asset/facilitator store DB short names
  //       ("base", "USDC", "coinbase_cdp"); CAIP-2 lives only at the SDK
  //       boundary (networks.ts).
  const insertResult = await insertConnectAtomic({
    principalId: wallet.principalId,
    walletId: wallet.walletId,
    platform: context.platform,
    connectionId,
    oauthState,
    redirectUri,
    expiresAt,
    chargeNonce: verifyResult.nonce,
    chargeRequestId: null,
    chargeTxHash: settleResult.txHash,
    chargeBlockNumber: settleResult.blockNumber,
    chargeAmountUsdc: verifyResult.chargeAmountUsdc,
    chargeFacilitatorFeeUsdc: settleResult.facilitatorFeeUsdc,
    chargeNetwork: context.network.name,
    chargeAsset: "USDC",
    chargePayerAddress: verifyResult.payerAddress,
    chargeRecipientAddress: context.recipientAddress,
    chargeFacilitator: FACILITATOR_NAME,
    chargeSettledAt: settleResult.settledAt,
  });

  if (!insertResult.ok) {
    // DB insert failed post-settle: MUST refund.
    console.error(`[handleConnectVerify] DB insert failed after settle (txHash=${settleResult.txHash}). Initiating refund. Error: ${insertResult.error.message}`);

    const refundResult = await refundPayment({
      originalTxHash: settleResult.txHash,
      payerAddress: verifyResult.payerAddress,
      amountUsdc: verifyResult.chargeAmountUsdc,
      network: context.network,
      reason: "db_insert_failed_post_settle_connect",
    });

    if (refundResult.ok) {
      console.log(`[handleConnectVerify] Refund succeeded: ${refundResult.refundTxHash}`);
    } else {
      // Settled money with no charge row and no refund: the tx hash in this
      // log line is the only reconciliation trail. Phase 4.4 owns tooling.
      console.error(`[handleConnectVerify] REFUND FAILED after settle (txHash=${settleResult.txHash}): ${refundResult.error.message}`);
    }

    return {
      ok: false,
      error: {
        kind: "db_insert_failed",
        message:
          insertResult.error.message ?? "DB insert failed after settlement.",
        refundInitiated: refundResult.ok,
        refundTxHash: refundResult.ok ? refundResult.refundTxHash : null,
      },
    };
  }

  // -- 10. Issue the HMAC connection token. The secret was checked before
  //        any charge, so this cannot fail here; the branch satisfies the
  //        result type.
  const tokenResult = issueConnectionToken({
    connectionId,
    walletAddress: wallet.address,
    chargeId: insertResult.chargeId,
    iat: Date.now(),
    exp: new Date(expiresAt).getTime() + CONNECTION_TOKEN_GRACE_MS,
    platform: context.platform,
  });
  if (!tokenResult.ok) {
    console.error("[handleConnectVerify] Token issuance failed after pre-check passed; connection is unpollable.");
  }

  return {
    ok: true,
    payload: {
      connectionId,
      platform: context.platform,
      oauthUrl: oauthResult.url,
      connectionToken: tokenResult.ok ? tokenResult.token : null,
      expiresAt,
      isReconnect: false,
    },
    settleResponseHeader,
    principal: wallet,
    chargeId: insertResult.chargeId,
  };
}
