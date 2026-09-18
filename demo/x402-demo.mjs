// Demo client for Sharetopus x402 paid endpoints.
//
// Usage: node x402-demo.mjs <command> [args]
//   challenge
//       Free. Shows the raw 402 price quote from /post-now.
//   connect <platform>
//       PAID (0.50 USDC). platform: linkedin | tiktok | pinterest | instagram.
//       Returns an oauthUrl to open in a browser plus a connectionToken.
//   status <connectionToken>
//       Free. Polls the OAuth connection until it reports connected.
//   accounts
//       PAID (0.001 USDC). Lists social accounts connected to the paying wallet.
//   post <social_account_id> <platform> <text...>
//       PAID (0.50 USDC, text). Publishes immediately.
//
// Network: X402_NETWORK=solana (default), base, or arc.
//   solana  SOLANA_PRIVATE_KEY: the 64-byte secret key as base58 (Phantom or
//           Solflare export) or as the JSON byte array solana-keygen writes.
//           Optional SOLANA_RPC_URL: dedicated RPC for the client's blockhash
//           read; unset uses the public mainnet endpoint.
//   base    EVM_PRIVATE_KEY: 0x-prefixed key of a wallet holding USDC on Base.
//   arc     EVM_PRIVATE_KEY: 0x-prefixed key of a wallet holding USDC on Arc.
//           The wallet needs no gas there either: it signs the same EIP-3009
//           authorization and Sharetopus broadcasts it.
// The wallet needs USDC only; the facilitator pays the network fee. Every
// command marked PAID spends real money. The client keeps @x402/fetch's
// default spend control: recognized USDC only, at most $1 per payment.
//
// Diagnostics go to stderr with a [function] prefix; API responses go to
// stdout untouched so they can be piped or recorded.

import {
  wrapFetchWithPaymentFromConfig,
  decodePaymentResponseHeader,
} from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { ExactSvmScheme, SOLANA_MAINNET_CAIP2 } from "@x402/svm";
import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { privateKeyToAccount } from "viem/accounts";
import { randomUUID } from "node:crypto";

const API_BASE = "https://sharetopus.com/api/x402";

// Keys are the ?network= slugs the API accepts; caipNetwork is what the x402
// client registers against and must equal accepts[0].network in the 402.
// sourceRef: src/lib/x402/networks.ts (base: eip155:8453); Solana from the
// constant @x402/svm exports.
const NETWORKS = {
  solana: {
    caipNetwork: SOLANA_MAINNET_CAIP2,
    label: "USDC on Solana mainnet",
    explorerTxUrl: (signature) => `https://explorer.solana.com/tx/${signature}`,
  },
  base: {
    caipNetwork: "eip155:8453",
    label: "USDC on Base",
    explorerTxUrl: (hash) => `https://basescan.org/tx/${hash}`,
  },
  // Arc is the one network Sharetopus settles itself, because no hosted
  // facilitator moves a plain EIP-3009 authorization from an agent wallet
  // there. Nothing changes on this side: the client signs the same exact
  // scheme it signs for Base, and still pays no gas.
  arc: {
    caipNetwork: "eip155:5042",
    label: "USDC on Arc mainnet",
    explorerTxUrl: (hash) => `https://explorer.arc.io/tx/${hash}`,
  },
};

// ed25519 secret key as solana-keygen and wallet exports lay it out:
// 32 private-key bytes followed by the 32-byte public key.
const SOLANA_SECRET_KEY_BYTES = 64;

const networkName = process.env.X402_NETWORK ?? "solana";
const network = NETWORKS[networkName];
if (!network) {
  exitWithError(
    `[main] X402_NETWORK must be one of ${Object.keys(NETWORKS).join(", ")}; got "${networkName}".`,
  );
}

function exitWithError(message) {
  console.error(message);
  process.exit(1);
}

function buildEndpointUrl(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("network", networkName);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return url;
}

function decodeSolanaSecretKey(rawKey) {
  const trimmedKey = rawKey.trim();
  if (trimmedKey.startsWith("[")) {
    try {
      return Uint8Array.from(JSON.parse(trimmedKey));
    } catch {
      return exitWithError(
        "[decodeSolanaSecretKey] SOLANA_PRIVATE_KEY looks like a JSON array but does not parse.",
      );
    }
  }
  try {
    return getBase58Encoder().encode(trimmedKey);
  } catch {
    return exitWithError(
      "[decodeSolanaSecretKey] SOLANA_PRIVATE_KEY is not valid base58.",
    );
  }
}

async function loadSolanaSigner() {
  const rawKey = process.env.SOLANA_PRIVATE_KEY;
  if (!rawKey) {
    exitWithError(
      "[loadSolanaSigner] Set SOLANA_PRIVATE_KEY to the 64-byte secret key of a wallet holding USDC on Solana (base58 or JSON byte array).",
    );
  }
  const secretKeyBytes = decodeSolanaSecretKey(rawKey);
  if (secretKeyBytes.length !== SOLANA_SECRET_KEY_BYTES) {
    exitWithError(
      `[loadSolanaSigner] Expected a ${SOLANA_SECRET_KEY_BYTES}-byte secret key, got ${secretKeyBytes.length} bytes.`,
    );
  }
  try {
    return await createKeyPairSignerFromBytes(secretKeyBytes);
  } catch {
    return exitWithError(
      "[loadSolanaSigner] SOLANA_PRIVATE_KEY does not form a valid ed25519 keypair (public half does not match).",
    );
  }
}

async function buildPaidFetch() {
  if (networkName === "solana") {
    const signer = await loadSolanaSigner();
    console.error(`[buildPaidFetch] Paying from ${signer.address} (${network.label})`);
    const solanaRpcUrl = process.env.SOLANA_RPC_URL;
    return wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [
        {
          network: network.caipNetwork,
          client: new ExactSvmScheme(
            signer,
            solanaRpcUrl ? { rpcUrl: solanaRpcUrl } : undefined,
          ),
        },
      ],
    });
  }

  const evmPrivateKey = process.env.EVM_PRIVATE_KEY;
  if (!evmPrivateKey || !evmPrivateKey.startsWith("0x")) {
    exitWithError(
      `[buildPaidFetch] Set EVM_PRIVATE_KEY to the 0x-prefixed key of a wallet holding ${network.label}.`,
    );
  }
  const account = privateKeyToAccount(evmPrivateKey);
  console.error(`[buildPaidFetch] Paying from ${account.address} (${network.label})`);
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: network.caipNetwork, client: new ExactEvmScheme(account) }],
  });
}

async function printResponse(response) {
  console.log(`HTTP ${response.status}`);
  const settleHeader = response.headers.get("PAYMENT-RESPONSE");
  if (settleHeader) {
    try {
      const settlement = decodePaymentResponseHeader(settleHeader);
      console.log("Payment settled:");
      console.log(JSON.stringify(settlement, null, 2));
      if (settlement.transaction) {
        console.log(`Explorer: ${network.explorerTxUrl(settlement.transaction)}`);
      }
    } catch {
      console.log(`PAYMENT-RESPONSE: ${settleHeader}`);
    }
  }
  // The body is read exactly once; JSON is pretty-printed, anything else raw.
  const bodyText = await response.text();
  try {
    console.log(JSON.stringify(JSON.parse(bodyText), null, 2));
  } catch {
    console.log(bodyText);
  }
  explainRecipientAccountFailure(response.status, bodyText);
}

// The facilitator simulates the payment before settling it. When the
// recipient wallet has never held USDC on Solana, its token account does not
// exist yet and the simulation fails inside the transfer instruction with
// InvalidAccountData. The x402 client never creates that account (only the
// recipient or a funder can), so the fix is on the operator's side.
// sourceRef: @x402/svm createPaymentPayload builds [computeLimit,
// computePrice, transferChecked, memo]; index 2 is the transfer.
function explainRecipientAccountFailure(status, bodyText) {
  if (status !== 502 || !bodyText.includes("InvalidAccountData")) return;
  console.error(
    "[explainRecipientAccountFailure] The recipient wallet has no USDC token account on this network yet, so the transfer cannot simulate. Nothing was charged. The operator must receive any USDC amount into the payTo wallet once; then retry.",
  );
}

const [command, ...commandArgs] = process.argv.slice(2);

if (command === "challenge") {
  // Valid body, no payment header: the server answers 402 with the price.
  const response = await fetch(buildEndpointUrl("/post-now"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      social_account_id: "00000000-0000-0000-0000-000000000000",
      platform: "linkedin",
      post_type: "text",
      description: "Demo post from an AI agent via x402",
    }),
  });
  await printResponse(response);
} else if (command === "connect") {
  const platform = commandArgs[0];
  if (!platform) {
    exitWithError("Usage: node x402-demo.mjs connect <linkedin|tiktok|pinterest|instagram>");
  }
  const paidFetch = await buildPaidFetch();
  const response = await paidFetch(buildEndpointUrl("/connect", { platform }), {
    method: "POST",
  });
  await printResponse(response);
  console.log("\nNext: open oauthUrl in a browser and authorize, then run:");
  console.log("  node x402-demo.mjs status <connectionToken>");
} else if (command === "status") {
  const connectionToken = commandArgs[0];
  if (!connectionToken) {
    exitWithError("Usage: node x402-demo.mjs status <connectionToken>");
  }
  const response = await fetch(buildEndpointUrl("/oauth/status"), {
    headers: { Authorization: `Bearer ${connectionToken}` },
  });
  await printResponse(response);
} else if (command === "accounts") {
  const paidFetch = await buildPaidFetch();
  const response = await paidFetch(buildEndpointUrl("/connections"), { method: "GET" });
  await printResponse(response);
} else if (command === "post") {
  const [socialAccountId, platform, ...words] = commandArgs;
  const text = words.join(" ");
  if (!socialAccountId || !platform || !text) {
    exitWithError("Usage: node x402-demo.mjs post <social_account_id> <platform> <text...>");
  }
  const paidFetch = await buildPaidFetch();
  const response = await paidFetch(buildEndpointUrl("/post-now"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      social_account_id: socialAccountId,
      platform,
      post_type: "text",
      description: text,
      idempotency_key: randomUUID(),
    }),
  });
  await printResponse(response);
} else {
  exitWithError(
    "Usage: node x402-demo.mjs <challenge | connect <platform> | status <token> | accounts | post <account_id> <platform> <text...>>",
  );
}
