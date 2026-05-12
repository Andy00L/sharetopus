/**
 * Pre-deploy check: verify the CDP Server Wallet has enough USDC and native
 * gas on every supported mainnet to handle refunds.
 *
 * Run with: npx tsx scripts/check-cdp-wallet-balance.ts
 *
 * Reads:
 *   CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET (CDP SDK)
 *   X402_RECIPIENT_EVM, X402_RECIPIENT_SOLANA (env)
 *
 * Exit codes:
 *   0 = all networks have minimum USDC ($5) and minimum gas
 *   1 = any network below threshold
 *   2 = config error (missing env, can't connect)
 */

import { CdpClient } from "@coinbase/cdp-sdk";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const MIN_USDC_PER_NETWORK_USDC = 5;

/** Minimum gas per network (in native token units). */
const MIN_GAS: Record<string, number> = {
  base: 0.001,
  polygon: 0.05,
  arbitrum: 0.001,
  solana: 0.005,
};

/** USDC contract addresses (from src/lib/x402/networks.ts). */
const USDC_ADDRESSES: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

/** Native token for display per chain. */
const NATIVE_TOKEN: Record<string, string> = {
  base: "ETH",
  polygon: "MATIC",
  arbitrum: "ETH",
  solana: "SOL",
};

/** EIP-7528 sentinel for native gas token in CDP balance responses. */
const EVM_NATIVE_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NetworkResult {
  network: string;
  address: string;
  usdcBalance: number;
  gasBalance: number;
  nativeSymbol: string;
  status: "OK" | "LOW_USDC" | "LOW_GAS" | "ERROR";
  error?: string;
}

// ---------------------------------------------------------------------------
// CDP-supported networks for listTokenBalances
// ---------------------------------------------------------------------------

// CDP SDK v1.49.0 ListEvmTokenBalancesNetwork only supports: base, base-sepolia, ethereum.
// For polygon and arbitrum, we fall back to direct JSON-RPC balance queries.
const CDP_SUPPORTED_EVM_BALANCE_NETWORKS = new Set(["base", "base-sepolia", "ethereum"]);

// ---------------------------------------------------------------------------
// EVM balance via direct RPC (for networks CDP API doesn't support)
// ---------------------------------------------------------------------------

const RPC_URLS: Record<string, string> = {
  polygon: "https://polygon-rpc.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",
};

async function queryEvmBalanceViaRpc(
  rpcUrl: string,
  walletAddress: string,
  usdcAddress: string
): Promise<{ usdcBalance: number; gasBalance: number }> {
  // ERC-20 balanceOf(address) calldata
  const selector = "70a08231";
  const paddedAddress = walletAddress.toLowerCase().replace("0x", "").padStart(64, "0");
  const balanceOfCalldata = `0x${selector}${paddedAddress}`;

  // Parallel: fetch USDC balance + native gas balance
  const [usdcResult, gasResult] = await Promise.all([
    fetchJsonRpc(rpcUrl, "eth_call", [
      { to: usdcAddress, data: balanceOfCalldata },
      "latest",
    ]),
    fetchJsonRpc(rpcUrl, "eth_getBalance", [walletAddress, "latest"]),
  ]);

  const usdcRaw = BigInt(usdcResult || "0x0");
  const gasRaw = BigInt(gasResult || "0x0");

  return {
    usdcBalance: Number(usdcRaw) / 1e6,
    gasBalance: Number(gasRaw) / 1e18,
  };
}

async function fetchJsonRpc(
  rpcUrl: string,
  method: string,
  params: unknown[]
): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await response.json()) as { result?: string; error?: { message: string } };
  if (json.error) {
    throw new Error(`[checkCdpWalletBalance] RPC error: ${json.error.message}`);
  }
  return json.result ?? "0x0";
}

// ---------------------------------------------------------------------------
// Check logic per chain type
// ---------------------------------------------------------------------------

async function checkEvmNetwork(
  cdp: CdpClient,
  network: string,
  walletAddress: string
): Promise<NetworkResult> {
  const usdcAddress = USDC_ADDRESSES[network];
  const nativeSymbol = NATIVE_TOKEN[network];

  try {
    let usdcBalance = 0;
    let gasBalance = 0;

    if (CDP_SUPPORTED_EVM_BALANCE_NETWORKS.has(network)) {
      // Use CDP API
      const result = await cdp.evm.listTokenBalances({
        address: walletAddress as `0x${string}`,
        network: network as "base" | "base-sepolia",
      });

      for (const bal of result.balances) {
        const addr = bal.token.contractAddress.toLowerCase();
        if (addr === usdcAddress.toLowerCase()) {
          usdcBalance = Number(bal.amount.amount) / 10 ** bal.amount.decimals;
        }
        if (addr === EVM_NATIVE_ADDRESS.toLowerCase()) {
          gasBalance = Number(bal.amount.amount) / 10 ** bal.amount.decimals;
        }
      }
    } else {
      // Fall back to direct RPC for unsupported networks
      const rpcUrl = RPC_URLS[network];
      if (!rpcUrl) {
        return {
          network,
          address: walletAddress,
          usdcBalance: 0,
          gasBalance: 0,
          nativeSymbol,
          status: "ERROR",
          error: `No RPC URL configured for ${network}`,
        };
      }
      const balances = await queryEvmBalanceViaRpc(rpcUrl, walletAddress, usdcAddress);
      usdcBalance = balances.usdcBalance;
      gasBalance = balances.gasBalance;
    }

    const minGas = MIN_GAS[network] ?? 0.001;
    let status: NetworkResult["status"] = "OK";
    if (usdcBalance < MIN_USDC_PER_NETWORK_USDC) status = "LOW_USDC";
    if (gasBalance < minGas) status = "LOW_GAS";

    return { network, address: walletAddress, usdcBalance, gasBalance, nativeSymbol, status };
  } catch (err) {
    console.error(`[checkCdpWalletBalance] Error checking ${network}:`, err instanceof Error ? err.message : err);
    return {
      network,
      address: walletAddress,
      usdcBalance: 0,
      gasBalance: 0,
      nativeSymbol,
      status: "ERROR",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function checkSolanaNetwork(
  cdp: CdpClient,
  walletAddress: string
): Promise<NetworkResult> {
  try {
    const result = await cdp.solana.listTokenBalances({
      address: walletAddress,
      network: "solana",
    });

    let usdcBalance = 0;
    let gasBalance = 0;
    const usdcMint = USDC_ADDRESSES.solana;

    for (const bal of result.balances) {
      if (bal.token.mintAddress === usdcMint) {
        usdcBalance = Number(bal.amount.amount) / 10 ** bal.amount.decimals;
      }
      // Native SOL wrapped mint address
      if (bal.token.mintAddress === "So11111111111111111111111111111111111111112") {
        gasBalance = Number(bal.amount.amount) / 10 ** bal.amount.decimals;
      }
    }

    const minGas = MIN_GAS.solana;
    let status: NetworkResult["status"] = "OK";
    if (usdcBalance < MIN_USDC_PER_NETWORK_USDC) status = "LOW_USDC";
    if (gasBalance < minGas) status = "LOW_GAS";

    return {
      network: "solana",
      address: walletAddress,
      usdcBalance,
      gasBalance,
      nativeSymbol: "SOL",
      status,
    };
  } catch (err) {
    console.error("[checkCdpWalletBalance] Error checking solana:", err instanceof Error ? err.message : err);
    return {
      network: "solana",
      address: walletAddress,
      usdcBalance: 0,
      gasBalance: 0,
      nativeSymbol: "SOL",
      status: "ERROR",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const evmAddress = process.env.X402_RECIPIENT_EVM;
  const solAddress = process.env.X402_RECIPIENT_SOLANA;

  if (!evmAddress && !solAddress) {
    console.error("[checkCdpWalletBalance] Neither X402_RECIPIENT_EVM nor X402_RECIPIENT_SOLANA is set.");
    process.exit(2);
  }

  if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET || !process.env.CDP_WALLET_SECRET) {
    console.error("[checkCdpWalletBalance] CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET are required.");
    process.exit(2);
  }

  const cdp = new CdpClient();
  const results: NetworkResult[] = [];

  // Check EVM networks in parallel
  if (evmAddress) {
    const evmNetworks = ["base", "polygon", "arbitrum"];
    const evmResults = await Promise.all(
      evmNetworks.map((net) => checkEvmNetwork(cdp, net, evmAddress))
    );
    results.push(...evmResults);
  }

  // Check Solana
  if (solAddress) {
    results.push(await checkSolanaNetwork(cdp, solAddress));
  }

  // Print table
  console.log("[checkCdpWalletBalance] Results:");
  const header = [
    "  ",
    "network".padEnd(16),
    "address".padEnd(22),
    "usdcBalance".padEnd(14),
    "gasBalance".padEnd(15),
    "status",
  ].join("");
  console.log("[checkCdpWalletBalance] " + header);
  console.log("[checkCdpWalletBalance] " + "-".repeat(header.length));

  let hasFailure = false;
  for (const r of results) {
    const shortAddr =
      r.address.length > 18
        ? r.address.slice(0, 6) + "..." + r.address.slice(-4)
        : r.address;
    const line = [
      "  ",
      r.network.padEnd(16),
      shortAddr.padEnd(22),
      `${r.usdcBalance.toFixed(2)} USDC`.padEnd(14),
      `${r.gasBalance.toFixed(4)} ${r.nativeSymbol}`.padEnd(15),
      r.status + (r.error ? ` (${r.error})` : ""),
    ].join("");
    console.log("[checkCdpWalletBalance] " + line);
    if (r.status !== "OK") hasFailure = true;
  }

  if (hasFailure) {
    console.log("[checkCdpWalletBalance] FAIL: one or more networks below threshold.");
    process.exit(1);
  } else {
    console.log("[checkCdpWalletBalance] PASS: all networks have sufficient balances.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("[checkCdpWalletBalance] Fatal error:", err instanceof Error ? err.message : err);
  process.exit(2);
});
