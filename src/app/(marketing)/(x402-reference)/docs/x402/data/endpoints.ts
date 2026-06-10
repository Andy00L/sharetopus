/**
 * Static content model for the public /docs/x402 reference page.
 *
 * Every literal in this file (header names, field names, enum values, status
 * codes, limits, addresses) was extracted from the x402 source, not from
 * docs/. Each section and operation carries a sourceRef naming the files it
 * was verified against; sourceRef is for maintainers only and is never
 * rendered. Amounts inside code samples are illustrative; the live 402
 * response always carries the current price from pricing_actions.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ParamRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ParamTableData {
  heading: string;
  rows: ParamRow[];
}

export interface CodeSample {
  label: string;
  code: string;
}

export interface CalloutData {
  tone: "amber" | "blue";
  text: string;
}

export interface EndpointOperation {
  /** Anchor id for deep links. Omitted when the section id already covers it. */
  id?: string;
  method: HttpMethod;
  path: string;
  title: string;
  description: string;
  paramTables: ParamTableData[];
  codeSamples: CodeSample[];
  callouts?: CalloutData[];
  sourceRef: string;
}

export interface FlowStep {
  title: string;
  body: string;
}

export interface SectionTable {
  columns: string[];
  rows: string[][];
}

export interface DocsSection {
  id: string;
  navLabel: string;
  title: string;
  summary: string;
  callouts?: CalloutData[];
  flowSteps?: FlowStep[];
  flowCodeSamples?: CodeSample[];
  statusFlow?: { steps: string[]; terminal: string[] };
  table?: SectionTable;
  tableNote?: string;
  operations?: EndpointOperation[];
  codeSamples?: CodeSample[];
  sourceRef: string;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export const OVERVIEW = {
  title: "x402 API Reference",
  subtitle:
    "Pay per action in USDC. No account and no API key: a wallet signature authorizes each request and settlement happens on-chain through the Coinbase CDP facilitator.",
  baseUrl: "https://sharetopus.com/api/x402",
  // sourceRef: src/lib/x402/networks.ts (mainnet-only registry)
  networks: ["base", "polygon", "arbitrum", "solana"],
  callout:
    "All four networks are mainnet. Every paid call settles real USDC. There is no test mode on this surface; start with the cheapest actions (see Pricing) while integrating.",
} as const;

// ---------------------------------------------------------------------------
// Shared code samples
// ---------------------------------------------------------------------------

const POST_NOW_402 = `{
  "x402Version": 2,
  "resource": { "url": "https://sharetopus.com/api/x402/post-now" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "750000",
      "payTo": "0xSHARETOPUS_RECEIVING_ADDRESS",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD Coin", "version": "2" }
    }
  ],
  "error": "PAYMENT-SIGNATURE header is required"
}`;

const QUICKSTART_CURL = `# 1. No payment attached: the server answers 402
curl -X POST "https://sharetopus.com/api/x402/post-now" \\
  -H "Content-Type: application/json" \\
  -d '{ "social_account_id": "...", "platform": "tiktok", "post_type": "text", "description": "hello" }'

# 2. Retry the same request with the signed payment payload
curl -X POST "https://sharetopus.com/api/x402/post-now" \\
  -H "Content-Type: application/json" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>" \\
  -d '{ "social_account_id": "...", "platform": "tiktok", "post_type": "text", "description": "hello" }'`;

const ENVELOPE_200 = `{
  "success": true,
  "data": { "...": "endpoint-specific result, see each endpoint" },
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa",
  "network": "base",
  "txHash": "0x6f2e8a1b...",
  "payerAddress": "0x9af31c5e..."
}`;

const SETTLE_HEADERS = `HTTP/2 200
PAYMENT-RESPONSE: <base64>
X-PAYMENT-RESPONSE: <base64>

# decoded PAYMENT-RESPONSE
{
  "success": true,
  "payer": "0x9af31c5e...",
  "transaction": "0x6f2e8a1b...",
  "network": "eip155:8453",
  "amount": "750000"
}`;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const DOCS_SECTIONS: DocsSection[] = [
  // ── Payment flow ────────────────────────────────────────────────────────
  {
    id: "payment-flow",
    navLabel: "Payment flow",
    title: "Payment flow",
    summary:
      "One round-trip to learn the price, one to pay and execute. The 402 response is the price quote; the retry carries the signed payment.",
    sourceRef:
      "src/lib/x402/middleware/x402PaidEndpoint.ts, src/lib/x402/http/paymentHttp.ts, src/lib/x402/payment/paymentPayload.ts",
    flowSteps: [
      {
        title: "Register your wallet once.",
        body: "POST /api/x402/register with no payment header returns 402 with payment requirements plus a SIWE nonce in extensions. Sign the SIWE message and the payment, then retry. Details under Wallet registration.",
      },
      {
        title: "Call a paid endpoint with no payment.",
        body: "Send the request as if the API were free. Pick a network with ?network= (default: base).",
      },
      {
        title: "Read the 402.",
        body: "The JSON body and the PAYMENT-REQUIRED response header carry the same object. accepts lists exactly one way to pay: scheme exact on your chosen network, amount in atomic USDC units (6 decimals), recipient in payTo.",
      },
      {
        title: "Sign the payment.",
        body: "EVM networks: sign an EIP-3009 authorization under the USDC EIP-712 domain carried in extra (name USD Coin, version 2). Solana: the exact scheme carries a partially signed transaction. Client libraries such as @x402/evm build this payload from the accepts entry.",
      },
      {
        title: "Retry with PAYMENT-SIGNATURE.",
        body: "Base64-encode the signed payment payload JSON and send it in the PAYMENT-SIGNATURE header on the same request. The v1 header name X-PAYMENT is also accepted.",
      },
      {
        title: "The server verifies, settles, then executes.",
        body: "Verification runs off-chain at the Coinbase CDP facilitator and includes sanctions screening. A pending charge is recorded before on-chain settlement, then the action runs. If a refundable step fails after settlement, the charge is refunded on-chain and the error body carries refundInitiated and refundTxHash. Settlement details return base64-encoded in the PAYMENT-RESPONSE header (v1 alias X-PAYMENT-RESPONSE).",
      },
      {
        title: "For social accounts: finish OAuth.",
        body: "connect returns oauthUrl and connectionToken. Open the URL in a browser, then poll GET /api/x402/oauth/status with the token until status is connected.",
      },
    ],
    flowCodeSamples: [
      { label: "Response · 402", code: POST_NOW_402 },
      { label: "Quickstart · cURL", code: QUICKSTART_CURL },
      { label: "Response · 200 · Envelope", code: ENVELOPE_200 },
      { label: "Settlement Headers", code: SETTLE_HEADERS },
    ],
    callouts: [
      {
        tone: "blue",
        text: "Each signed payment is single use. Presenting the same payment twice returns 409 replay. Sign a fresh payment for every call.",
      },
    ],
  },

  // ── Wallet registration ─────────────────────────────────────────────────
  {
    id: "register",
    navLabel: "Register wallet",
    title: "Wallet registration",
    summary:
      "One-time onboarding, itself paid (the register action). The same POST route serves the challenge (no payment header) and the verify (payment header present).",
    sourceRef:
      "src/app/api/x402/register/route.ts, src/lib/x402/register/handleRegisterChallenge.ts, handleRegisterVerify.ts, handleRegisterSolanaVerify.ts, src/lib/x402/siwe/*",
    operations: [
      {
        id: "register-challenge",
        method: "POST",
        path: "/api/x402/register",
        title: "Request a registration challenge",
        description:
          "Call with no PAYMENT-SIGNATURE header. Returns 402 with the payment requirements for the register action plus a fresh SIWE nonce in extensions. The nonce is single use and expires 300 seconds after issuance.",
        sourceRef:
          "src/lib/x402/register/handleRegisterChallenge.ts, src/lib/x402/siwe/createSiweNonce.ts",
        paramTables: [
          {
            heading: "Query Parameters",
            rows: [
              {
                name: "network",
                type: "string",
                required: false,
                description:
                  "Payment network: base, polygon, arbitrum, or solana. Default base. Unknown values return 400 unsupported_network.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl -X POST "https://sharetopus.com/api/x402/register?network=base"`,
          },
          {
            label: "Response · 402",
            code: `{
  "x402Version": 2,
  "resource": { "url": "https://sharetopus.com/api/x402/register" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "1000000",
      "payTo": "0xSHARETOPUS_RECEIVING_ADDRESS",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD Coin", "version": "2" }
    }
  ],
  "extensions": {
    "siweNonce": "kPaXM3GZbXVtMW3sJq2r9",
    "siweExpiresAt": "2026-06-09T12:05:00.000Z"
  }
}`,
          },
        ],
      },
      {
        id: "register-verify",
        method: "POST",
        path: "/api/x402/register",
        title: "Verify and register",
        description:
          "Retry the same route with the signed payment in PAYMENT-SIGNATURE and the signed sign-in message in the body. EVM wallets sign an EIP-4361 (SIWE) message; smart wallets verify via EIP-1271/ERC-6492 through the network RPC. Solana wallets sign the SIWS message text with Ed25519. The verify path follows the network family of ?network. A wallet flagged by sanctions screening is rejected with 403 sanctioned.",
        sourceRef:
          "src/lib/x402/register/handleRegisterVerify.ts, src/lib/x402/solana/verifySolanaSiweAuth.ts, src/lib/x402/siwe/verifySiweAuth.ts, consumeSiweNonce.ts",
        paramTables: [
          {
            heading: "Request Body",
            rows: [
              {
                name: "siweMessage",
                type: "string",
                required: true,
                description:
                  "The signed message text. Must carry the nonce from the challenge, the domain sharetopus.com, and a URI exactly equal to https://sharetopus.com/api/x402/register. EVM messages must also carry the chain id of the payment network.",
              },
              {
                name: "siweSignature",
                type: "string",
                required: true,
                description:
                  "EVM: hex signature, 0x-prefixed. Solana: base58 Ed25519 signature.",
              },
            ],
          },
          {
            heading: "Response Fields",
            rows: [
              {
                name: "principalId",
                type: "string",
                required: true,
                description: "Wallet principal id, format wallet_<32 hex chars>.",
              },
              {
                name: "walletId",
                type: "string",
                required: true,
                description: "Same value as principalId.",
              },
              {
                name: "address",
                type: "string",
                required: true,
                description:
                  "Registered wallet address. EVM addresses are stored lowercase; Solana addresses keep their casing.",
              },
              {
                name: "chain",
                type: "string",
                required: true,
                description: "base, polygon, arbitrum, or solana.",
              },
              {
                name: "sanctionsStatus",
                type: "string",
                required: true,
                description: "clean for fresh registrations.",
              },
              {
                name: "isNew",
                type: "boolean",
                required: true,
                description: "false when the wallet was already registered.",
              },
              {
                name: "chargeId",
                type: "string | null",
                required: true,
                description:
                  "Charge id for this registration. Null when isNew is false.",
              },
            ],
          },
        ],
        callouts: [
          {
            tone: "amber",
            text: "Keep your wallet key offline. The API never needs the key, only signatures: one sign-in signature to prove wallet ownership at registration and one payment signature per paid call.",
          },
          {
            tone: "blue",
            text: "Re-registering an existing wallet returns 200 with isNew false and charges nothing. The unclaimed payment authorization simply expires.",
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl -X POST "https://sharetopus.com/api/x402/register?network=base" \\
  -H "Content-Type: application/json" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>" \\
  -d '{
    "siweMessage": "<EIP-4361 message: domain sharetopus.com, uri https://sharetopus.com/api/x402/register, chain id of your network, nonce from the challenge>",
    "siweSignature": "0x57c2b1..."
  }'`,
          },
          {
            label: "Response · 200",
            code: `{
  "principalId": "wallet_2f6a1c0e9b8d4a7f5c3e1d2b4a6c8e0f",
  "walletId": "wallet_2f6a1c0e9b8d4a7f5c3e1d2b4a6c8e0f",
  "address": "0x9af31c5e...",
  "chain": "base",
  "sanctionsStatus": "clean",
  "isNew": true,
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa"
}`,
          },
        ],
      },
    ],
  },

  // ── Connect a social account ────────────────────────────────────────────
  {
    id: "connect",
    navLabel: "Connect account",
    title: "Connect a social account",
    summary:
      "Paid OAuth initiation for linkedin, tiktok, pinterest, and instagram. No request body: the wallet is identified by the payment signature alone.",
    sourceRef:
      "src/app/api/x402/connect/route.ts, src/lib/x402/connect/handleConnectChallenge.ts, handleConnectVerify.ts, src/lib/x402/config.ts",
    operations: [
      {
        id: "connect-challenge",
        method: "POST",
        path: "/api/x402/connect",
        title: "Request connect requirements",
        description:
          "Call with ?platform and no PAYMENT-SIGNATURE header. Returns 402 quoting the connect_account price. No SIWE nonce here; the wallet is already registered.",
        sourceRef: "src/lib/x402/connect/handleConnectChallenge.ts",
        paramTables: [
          {
            heading: "Query Parameters",
            rows: [
              {
                name: "platform",
                type: "string",
                required: true,
                description:
                  "One of linkedin, tiktok, pinterest, instagram. Anything else returns 400 invalid_platform.",
              },
              {
                name: "network",
                type: "string",
                required: false,
                description:
                  "base, polygon, arbitrum, or solana. Default base.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl -X POST "https://sharetopus.com/api/x402/connect?platform=tiktok"`,
          },
          {
            label: "Response · 402",
            code: `{
  "x402Version": 2,
  "resource": { "url": "https://sharetopus.com/api/x402/connect" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "500000",
      "payTo": "0xSHARETOPUS_RECEIVING_ADDRESS",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD Coin", "version": "2" }
    }
  ]
}`,
          },
        ],
      },
      {
        id: "connect-verify",
        method: "POST",
        path: "/api/x402/connect",
        title: "Pay and get the OAuth URL",
        description:
          "Retry with the payment attached. On success the wallet is charged connect_account and the response carries the OAuth URL to open in a browser plus a connection token for status polling. The pending connection stays claimable for 15 minutes. An unregistered paying wallet gets 401 wallet_not_registered on this route.",
        sourceRef: "src/lib/x402/connect/handleConnectVerify.ts",
        paramTables: [
          {
            heading: "Response Fields",
            rows: [
              {
                name: "connectionId",
                type: "string",
                required: true,
                description: "Id of the pending connection.",
              },
              {
                name: "platform",
                type: "string",
                required: true,
                description: "Echoes the requested platform.",
              },
              {
                name: "oauthUrl",
                type: "string | null",
                required: true,
                description:
                  "Authorization URL to open in a browser. Null on idempotent reconnects.",
              },
              {
                name: "connectionToken",
                type: "string | null",
                required: true,
                description:
                  "Opaque signed token for GET /api/x402/oauth/status, sent as Authorization: Bearer. Valid until the connection expiry plus a 1 hour grace period. Null on reconnects whose account predates connection tracking.",
              },
              {
                name: "expiresAt",
                type: "string",
                required: true,
                description:
                  "ISO timestamp. New connections expire 15 minutes after creation.",
              },
              {
                name: "isReconnect",
                type: "boolean",
                required: true,
                description:
                  "True when an existing healthy connection was returned instead of starting OAuth.",
              },
            ],
          },
        ],
        callouts: [
          {
            tone: "blue",
            text: "Reconnecting an already-connected account returns oauthUrl null, does not start a new OAuth flow, and charges nothing.",
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl -X POST "https://sharetopus.com/api/x402/connect?platform=tiktok" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>"`,
          },
          {
            label: "Response · 200",
            code: `{
  "connectionId": "e3b7c9d1-2a4f-48e0-b1c2-9d8e7f6a5b4c",
  "platform": "tiktok",
  "oauthUrl": "https://www.tiktok.com/v2/auth/authorize/?...",
  "connectionToken": "v1.eyJjb25uZWN0aW9uSWQiOiAi...In0.5rT9vQ...",
  "expiresAt": "2026-06-09T12:15:00.000Z",
  "isReconnect": false
}`,
          },
        ],
      },
    ],
  },

  // ── Poll connection status ──────────────────────────────────────────────
  {
    id: "status",
    navLabel: "Connection status",
    title: "Poll connection status",
    summary: "Free polling endpoint. The connection token is the only credential.",
    sourceRef:
      "src/app/api/x402/oauth/status/route.ts, src/lib/x402/oauth/status/handleStatusQuery.ts, src/lib/x402/config.ts (MAX_POLLS_PER_CONNECTION)",
    statusFlow: {
      steps: ["pending", "connected"],
      terminal: ["expired", "failed", "revoked"],
    },
    operations: [
      {
        method: "GET",
        path: "/api/x402/oauth/status",
        title: "Poll connection status",
        description:
          "Send the connection token from connect or reauth as a Bearer token. Each poll increments a per-connection counter; at 720 polls the endpoint returns 429 poll_limit_exceeded for that connection. No poll interval is suggested by the API: polling is capped and rate limited at 120 requests per minute per IP, cadence is up to the client. A pending connection past its expiry is reported as expired. After the user finishes OAuth in the browser, status moves to connected.",
        sourceRef: "src/lib/x402/oauth/status/handleStatusQuery.ts",
        paramTables: [
          {
            heading: "Headers",
            rows: [
              {
                name: "Authorization",
                type: "string",
                required: true,
                description: "Bearer <connectionToken>.",
              },
            ],
          },
          {
            heading: "Response Fields",
            rows: [
              {
                name: "connectionId",
                type: "string",
                required: true,
                description: "Connection being polled.",
              },
              {
                name: "platform",
                type: "string",
                required: true,
                description: "OAuth platform.",
              },
              {
                name: "status",
                type: "string",
                required: true,
                description:
                  "pending, connected, expired, failed, or revoked.",
              },
              {
                name: "connectedAt",
                type: "string | null",
                required: true,
                description: "Set when status reaches connected.",
              },
              {
                name: "expiresAt",
                type: "string",
                required: true,
                description: "When the pending connection stops being claimable.",
              },
              {
                name: "socialAccountId",
                type: "string | null",
                required: true,
                description:
                  "The connected account id, usable with post endpoints once set.",
              },
              {
                name: "pollCount",
                type: "number",
                required: true,
                description: "Poll count after this request, toward the 720 cap.",
              },
              {
                name: "errorCode",
                type: "string | null",
                required: true,
                description: "Set when the OAuth flow failed.",
              },
              {
                name: "errorMessage",
                type: "string | null",
                required: true,
                description: "Human-readable failure detail.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl "https://sharetopus.com/api/x402/oauth/status" \\
  -H "Authorization: Bearer v1.eyJjb25uZWN0aW9uSWQiOiAi...In0.5rT9vQ..."`,
          },
          {
            label: "Response · 200",
            code: `{
  "connectionId": "e3b7c9d1-2a4f-48e0-b1c2-9d8e7f6a5b4c",
  "platform": "tiktok",
  "status": "connected",
  "connectedAt": "2026-06-09T12:03:21.000Z",
  "expiresAt": "2026-06-09T12:15:00.000Z",
  "socialAccountId": "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d",
  "pollCount": 14,
  "errorCode": null,
  "errorMessage": null
}`,
          },
          {
            label: "Response · 429",
            code: `{
  "error": "poll_limit_exceeded",
  "message": "Poll limit reached for this connection (720)."
}`,
          },
        ],
      },
    ],
  },

  // ── Reauthorize a connection ────────────────────────────────────────────
  {
    id: "reauth",
    navLabel: "Reauthorize",
    title: "Reauthorize a connection",
    summary:
      "Re-authenticate an expired social connection. Paid, same connect_account action as connect.",
    sourceRef: "src/app/api/x402/reauth/route.ts",
    operations: [
      {
        method: "POST",
        path: "/api/x402/reauth",
        title: "Reauthorize a connection",
        description:
          "For a connected account whose platform token expired (is_available false in the connections list). Returns a fresh OAuth URL and connection token. The target account must belong to the paying wallet. Ownership and eligibility checks run after settlement: a failed check (account not found, not owned, reauth not needed, unsupported platform) returns 500 with the charge refunded on-chain and refundInitiated true in the body.",
        sourceRef: "src/app/api/x402/reauth/route.ts",
        paramTables: [
          {
            heading: "Request Body",
            rows: [
              {
                name: "social_account_id",
                type: "string (uuid)",
                required: true,
                description: "Account id from GET /api/x402/connections.",
              },
            ],
          },
          {
            heading: "Response Fields (data)",
            rows: [
              {
                name: "connectionId",
                type: "string",
                required: true,
                description: "New pending connection id.",
              },
              {
                name: "platform",
                type: "string",
                required: true,
                description: "Platform of the account.",
              },
              {
                name: "oauthUrl",
                type: "string",
                required: true,
                description: "Authorization URL to open in a browser.",
              },
              {
                name: "connectionToken",
                type: "string",
                required: true,
                description: "Bearer token for status polling.",
              },
              {
                name: "expiresAt",
                type: "string",
                required: true,
                description: "15 minutes after creation.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl -X POST "https://sharetopus.com/api/x402/reauth" \\
  -H "Content-Type: application/json" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>" \\
  -d '{ "social_account_id": "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d" }'`,
          },
          {
            label: "Response · 200",
            code: `{
  "success": true,
  "data": {
    "connectionId": "a91c4e7f-6b2d-4c8a-9e0f-1d2c3b4a5e6f",
    "platform": "linkedin",
    "oauthUrl": "https://www.linkedin.com/oauth/v2/authorization?...",
    "connectionToken": "v1.eyJjb25uZWN0aW9uSWQiOiAi...In0.8wY2xK...",
    "expiresAt": "2026-06-09T12:15:00.000Z"
  },
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa",
  "network": "base",
  "txHash": "0x6f2e8a1b...",
  "payerAddress": "0x9af31c5e..."
}`,
          },
        ],
      },
    ],
  },

  // ── Post now ────────────────────────────────────────────────────────────
  {
    id: "post-now",
    navLabel: "Post now",
    title: "Post now",
    summary:
      "Publish immediately to one connected account. The price follows the post type.",
    sourceRef:
      "src/app/api/x402/post-now/route.ts, src/lib/x402/middleware/postBodySchema.ts, resolvePostAction.ts",
    operations: [
      {
        method: "POST",
        path: "/api/x402/post-now",
        title: "Create a post",
        description:
          "Charges post.text, post.image, or post.video based on post_type. Posting runs asynchronously after settlement; the response identifies the dispatched work, not the platform post id. If the dispatch fails, the charge is refunded on-chain.",
        sourceRef: "src/app/api/x402/post-now/route.ts",
        paramTables: [
          {
            heading: "Request Body",
            rows: [
              {
                name: "social_account_id",
                type: "string (uuid)",
                required: true,
                description: "Connected account to post from.",
              },
              {
                name: "platform",
                type: "string",
                required: true,
                description:
                  "linkedin, tiktok, pinterest, or instagram. Must match the account.",
              },
              {
                name: "post_type",
                type: "string",
                required: true,
                description:
                  "text, image, or video. Selects the pricing action.",
              },
              {
                name: "description",
                type: "string | null",
                required: true,
                description:
                  "Post body text. The key is required; the value may be null.",
              },
              {
                name: "media_storage_path",
                type: "string",
                required: false,
                description:
                  "Required for image and video posts. The path returned by POST /api/x402/upload-url.",
              },
              {
                name: "title",
                type: "string | null",
                required: false,
                description: "Post title where the platform supports one.",
              },
              {
                name: "cover_timestamp",
                type: "number",
                required: false,
                description: "Video cover frame timestamp.",
              },
              {
                name: "pinterest_board_id",
                type: "string",
                required: false,
                description: "Pinterest board id.",
              },
              {
                name: "pinterest_board_name",
                type: "string",
                required: false,
                description: "Pinterest board name.",
              },
              {
                name: "pinterest_link",
                type: "string",
                required: false,
                description: "Outbound link for Pinterest pins.",
              },
              {
                name: "idempotency_key",
                type: "string",
                required: false,
                description: "Client-supplied key to dedupe retries.",
              },
            ],
          },
          {
            heading: "Response Fields (data)",
            rows: [
              {
                name: "batchId",
                type: "string",
                required: true,
                description: "Batch identifier for this dispatch.",
              },
              {
                name: "eventIds",
                type: "string[]",
                required: true,
                description: "Ids of the dispatched posting jobs.",
              },
              {
                name: "dispatched",
                type: "number",
                required: true,
                description: "Count of jobs dispatched.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl -X POST "https://sharetopus.com/api/x402/post-now" \\
  -H "Content-Type: application/json" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>" \\
  -d '{
    "social_account_id": "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d",
    "platform": "tiktok",
    "post_type": "video",
    "description": "Launch day.",
    "media_storage_path": "wallet_2f6a1c0e.../launch.mp4"
  }'`,
          },
          {
            label: "Response · 200",
            code: `{
  "success": true,
  "data": {
    "batchId": "f7e6d5c4-b3a2-4190-8f7e-6d5c4b3a2918",
    "eventIds": ["a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"],
    "dispatched": 1
  },
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa",
  "network": "base",
  "txHash": "0x6f2e8a1b...",
  "payerAddress": "0x9af31c5e..."
}`,
          },
        ],
      },
    ],
  },

  // ── Schedule a post ─────────────────────────────────────────────────────
  {
    id: "schedule",
    navLabel: "Schedule post",
    title: "Schedule a post",
    summary: "Same body as post-now plus a future timestamp.",
    sourceRef: "src/app/api/x402/schedule/route.ts",
    operations: [
      {
        method: "POST",
        path: "/api/x402/schedule",
        title: "Schedule a post",
        description:
          "Charges the same post.text / post.image / post.video actions. The post is stored and published by the scheduler at scheduled_at. The body accepts every post-now field plus the two below. Scheduling failures after settlement are refunded on-chain.",
        sourceRef: "src/app/api/x402/schedule/route.ts",
        paramTables: [
          {
            heading: "Request Body (in addition to post-now fields)",
            rows: [
              {
                name: "scheduled_at",
                type: "string",
                required: true,
                description:
                  "ISO 8601 datetime. Must parse and be in the future.",
              },
              {
                name: "post_options",
                type: "object | null",
                required: false,
                description:
                  "Per-platform options object passed through to the scheduler.",
              },
            ],
          },
          {
            heading: "Response Fields (data)",
            rows: [
              {
                name: "batchId",
                type: "string",
                required: true,
                description: "Batch identifier for this schedule call.",
              },
              {
                name: "scheduleIds",
                type: "string[]",
                required: true,
                description:
                  "Ids of the created scheduled posts. Use them with reschedule, cancel, and delete.",
              },
              {
                name: "inserted",
                type: "number",
                required: true,
                description: "Count of posts stored.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl -X POST "https://sharetopus.com/api/x402/schedule" \\
  -H "Content-Type: application/json" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>" \\
  -d '{
    "social_account_id": "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d",
    "platform": "pinterest",
    "post_type": "image",
    "description": "Summer lookbook, part 2.",
    "media_storage_path": "wallet_2f6a1c0e.../lookbook-2.jpg",
    "title": "Summer lookbook",
    "pinterest_board_id": "1234567890",
    "pinterest_link": "https://example.com/lookbook",
    "scheduled_at": "2026-06-12T16:00:00.000Z"
  }'`,
          },
          {
            label: "Response · 200",
            code: `{
  "success": true,
  "data": {
    "batchId": "f7e6d5c4-b3a2-4190-8f7e-6d5c4b3a2918",
    "scheduleIds": ["c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f"],
    "inserted": 1
  },
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa",
  "network": "base",
  "txHash": "0x6f2e8a1b...",
  "payerAddress": "0x9af31c5e..."
}`,
          },
        ],
      },
    ],
  },

  // ── Upload media ────────────────────────────────────────────────────────
  {
    id: "upload",
    navLabel: "Upload media",
    title: "Upload media",
    summary: "Mint a signed upload URL for post media.",
    sourceRef:
      "src/app/api/x402/upload-url/route.ts, src/lib/x402/storage/enforceWalletStorageQuota.ts, src/lib/types/plans.ts (WALLET_STORAGE_LIMIT)",
    operations: [
      {
        method: "POST",
        path: "/api/x402/upload-url",
        title: "Create an upload URL",
        description:
          "Charges upload_url. Returns a signed storage URL. Upload the file to uploadUrl, then pass path as media_storage_path when posting or scheduling. Wallet storage is capped at 5 GB in total; a request that would exceed the cap fails after settlement with quota_exceeded and the charge is refunded.",
        sourceRef: "src/app/api/x402/upload-url/route.ts",
        paramTables: [
          {
            heading: "Request Body",
            rows: [
              {
                name: "filename",
                type: "string",
                required: true,
                description: "1 to 255 characters.",
              },
              {
                name: "content_type",
                type: "string",
                required: true,
                description: "MIME type of the file.",
              },
              {
                name: "size_bytes",
                type: "number",
                required: true,
                description:
                  "Positive integer. Max 262144000 (250 MB) per file.",
              },
            ],
          },
          {
            heading: "Response Fields (data)",
            rows: [
              {
                name: "uploadUrl",
                type: "string",
                required: true,
                description: "Signed upload URL.",
              },
              {
                name: "path",
                type: "string",
                required: true,
                description:
                  "Storage path to use as media_storage_path in post-now and schedule.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl -X POST "https://sharetopus.com/api/x402/upload-url" \\
  -H "Content-Type: application/json" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>" \\
  -d '{ "filename": "launch.mp4", "content_type": "video/mp4", "size_bytes": 10485760 }'`,
          },
          {
            label: "Response · 200",
            code: `{
  "success": true,
  "data": {
    "uploadUrl": "https://...supabase.co/storage/v1/object/upload/sign/...",
    "path": "wallet_2f6a1c0e.../launch.mp4"
  },
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa",
  "network": "base",
  "txHash": "0x6f2e8a1b...",
  "payerAddress": "0x9af31c5e..."
}`,
          },
        ],
      },
    ],
  },

  // ── Manage scheduled posts ──────────────────────────────────────────────
  {
    id: "manage-posts",
    navLabel: "Manage posts",
    title: "Manage scheduled posts",
    summary:
      "Move, cancel, or hard-delete scheduled posts. The batch endpoints accept 1 to 50 ids per call.",
    sourceRef:
      "src/app/api/x402/reschedule/route.ts, cancel/route.ts, delete/route.ts",
    operations: [
      {
        id: "reschedule",
        method: "POST",
        path: "/api/x402/reschedule",
        title: "Reschedule a post",
        description:
          "Charges reschedule. Moves one scheduled post to a new future time.",
        sourceRef: "src/app/api/x402/reschedule/route.ts",
        paramTables: [
          {
            heading: "Request Body",
            rows: [
              {
                name: "post_id",
                type: "string (uuid)",
                required: true,
                description: "Scheduled post to move.",
              },
              {
                name: "new_scheduled_time",
                type: "string",
                required: true,
                description: "ISO 8601 datetime. Must be in the future.",
              },
            ],
          },
          {
            heading: "Response Fields (data)",
            rows: [
              {
                name: "succeeded",
                type: "number",
                required: true,
                description: "Posts moved.",
              },
              {
                name: "resumed",
                type: "number",
                required: true,
                description: "Previously paused posts resumed by the move.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl -X POST "https://sharetopus.com/api/x402/reschedule" \\
  -H "Content-Type: application/json" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>" \\
  -d '{
    "post_id": "c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f",
    "new_scheduled_time": "2026-06-13T09:00:00.000Z"
  }'`,
          },
          {
            label: "Response · 200",
            code: `{
  "success": true,
  "data": { "succeeded": 1, "resumed": 0 },
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa",
  "network": "base",
  "txHash": "0x6f2e8a1b...",
  "payerAddress": "0x9af31c5e..."
}`,
          },
        ],
      },
      {
        id: "cancel",
        method: "POST",
        path: "/api/x402/cancel",
        title: "Cancel scheduled posts",
        description:
          "Charges cancel. Cancels 1 to 50 scheduled posts owned by the wallet. Cancelled posts keep their row and media.",
        sourceRef: "src/app/api/x402/cancel/route.ts",
        paramTables: [
          {
            heading: "Request Body",
            rows: [
              {
                name: "post_ids",
                type: "string[] (uuid)",
                required: true,
                description: "1 to 50 scheduled post ids.",
              },
            ],
          },
          {
            heading: "Response Fields (data)",
            rows: [
              {
                name: "succeeded",
                type: "number",
                required: true,
                description: "Posts cancelled.",
              },
              {
                name: "failed",
                type: "number",
                required: true,
                description: "Posts that could not be cancelled.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl -X POST "https://sharetopus.com/api/x402/cancel" \\
  -H "Content-Type: application/json" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>" \\
  -d '{ "post_ids": ["c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f"] }'`,
          },
          {
            label: "Response · 200",
            code: `{
  "success": true,
  "data": { "succeeded": 1, "failed": 0 },
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa",
  "network": "base",
  "txHash": "0x6f2e8a1b...",
  "payerAddress": "0x9af31c5e..."
}`,
          },
        ],
      },
      {
        id: "delete",
        method: "POST",
        path: "/api/x402/delete",
        title: "Delete posts",
        description:
          "Charges delete. Hard deletes 1 to 50 scheduled or completed posts and their stored media. Not reversible.",
        sourceRef: "src/app/api/x402/delete/route.ts",
        paramTables: [
          {
            heading: "Request Body",
            rows: [
              {
                name: "post_ids",
                type: "string[] (uuid)",
                required: true,
                description: "1 to 50 post ids.",
              },
            ],
          },
          {
            heading: "Response Fields (data)",
            rows: [
              {
                name: "succeeded",
                type: "number",
                required: true,
                description: "Posts deleted.",
              },
              {
                name: "failed",
                type: "number",
                required: true,
                description: "Posts that could not be deleted.",
              },
              {
                name: "mediaDeleted",
                type: "number",
                required: true,
                description: "Media files removed from storage.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl -X POST "https://sharetopus.com/api/x402/delete" \\
  -H "Content-Type: application/json" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>" \\
  -d '{ "post_ids": ["c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f"] }'`,
          },
          {
            label: "Response · 200",
            code: `{
  "success": true,
  "data": { "succeeded": 1, "failed": 0, "mediaDeleted": 1 },
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa",
  "network": "base",
  "txHash": "0x6f2e8a1b...",
  "payerAddress": "0x9af31c5e..."
}`,
          },
        ],
      },
    ],
  },

  // ── Read endpoints ──────────────────────────────────────────────────────
  {
    id: "reads",
    navLabel: "Read endpoints",
    title: "Read endpoints",
    summary:
      "Paid GET endpoints. The payment signature authenticates the wallet; the 402 flow is the same as for POST routes.",
    sourceRef:
      "src/app/api/x402/connections/route.ts, scheduled-posts/route.ts, history/route.ts",
    operations: [
      {
        id: "connections",
        method: "GET",
        path: "/api/x402/connections",
        title: "List connected accounts",
        description:
          "Charges list_connections. Returns the wallet's connected social accounts. Platform tokens are never included.",
        sourceRef: "src/app/api/x402/connections/route.ts",
        paramTables: [
          {
            heading: "Query Parameters",
            rows: [
              {
                name: "include_unavailable",
                type: "string",
                required: false,
                description:
                  "true to include accounts whose platform token expired (candidates for reauth). Default: only available accounts.",
              },
            ],
          },
          {
            heading: "Response Fields (data.accounts[])",
            rows: [
              {
                name: "id",
                type: "string",
                required: true,
                description:
                  "Account id, used as social_account_id elsewhere.",
              },
              {
                name: "platform",
                type: "string",
                required: true,
                description: "Social platform of the account.",
              },
              {
                name: "display_name",
                type: "string | null",
                required: true,
                description: "Profile display name.",
              },
              {
                name: "username",
                type: "string | null",
                required: true,
                description: "Profile handle.",
              },
              {
                name: "avatar_url",
                type: "string | null",
                required: true,
                description: "Profile image URL.",
              },
              {
                name: "is_available",
                type: "boolean",
                required: true,
                description:
                  "False when the platform token expired; use reauth.",
              },
              {
                name: "follower_count",
                type: "number | null",
                required: true,
                description: "Follower count at last sync.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl "https://sharetopus.com/api/x402/connections?include_unavailable=true" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>"`,
          },
          {
            label: "Response · 200",
            code: `{
  "success": true,
  "data": {
    "accounts": [
      {
        "id": "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d",
        "platform": "tiktok",
        "display_name": "Studio",
        "username": "studio.daily",
        "avatar_url": "https://...",
        "is_available": true,
        "follower_count": 1280
      }
    ]
  },
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa",
  "network": "base",
  "txHash": "0x6f2e8a1b...",
  "payerAddress": "0x9af31c5e..."
}`,
          },
        ],
      },
      {
        id: "scheduled-posts",
        method: "GET",
        path: "/api/x402/scheduled-posts",
        title: "List scheduled posts",
        description: "Charges list_posts. Returns the wallet's scheduled posts.",
        sourceRef: "src/app/api/x402/scheduled-posts/route.ts",
        paramTables: [
          {
            heading: "Query Parameters",
            rows: [
              {
                name: "status",
                type: "string",
                required: false,
                description:
                  "scheduled, queued, processing, posted, failed, or cancelled.",
              },
              {
                name: "platform",
                type: "string",
                required: false,
                description: "Filter by platform.",
              },
              {
                name: "limit",
                type: "number",
                required: false,
                description: "1 to 100. Default 20.",
              },
            ],
          },
          {
            heading: "Response Fields (data.posts[])",
            rows: [
              {
                name: "id",
                type: "string",
                required: true,
                description: "Scheduled post id.",
              },
              {
                name: "scheduled_at",
                type: "string",
                required: true,
                description: "Publish time, ISO 8601.",
              },
              {
                name: "status",
                type: "string",
                required: true,
                description:
                  "scheduled, queued, processing, posted, failed, or cancelled.",
              },
              {
                name: "platform",
                type: "string",
                required: true,
                description: "Target platform.",
              },
              {
                name: "post_title",
                type: "string | null",
                required: true,
                description: "Title, when set.",
              },
              {
                name: "post_description",
                type: "string | null",
                required: true,
                description: "Body text, when set.",
              },
              {
                name: "media_type",
                type: "string",
                required: true,
                description: "text, image, or video.",
              },
              {
                name: "media_storage_path",
                type: "string",
                required: true,
                description: "Storage path of the attached media.",
              },
              {
                name: "error_message",
                type: "string | null",
                required: true,
                description: "Set when publishing failed.",
              },
              {
                name: "batch_id",
                type: "string | null",
                required: true,
                description: "Batch the post was created in.",
              },
              {
                name: "created_via",
                type: "string",
                required: true,
                description: "x402 for posts created through this API.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl "https://sharetopus.com/api/x402/scheduled-posts?status=scheduled&limit=20" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>"`,
          },
          {
            label: "Response · 200",
            code: `{
  "success": true,
  "data": {
    "posts": [
      {
        "id": "c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f",
        "scheduled_at": "2026-06-12T16:00:00.000Z",
        "status": "scheduled",
        "platform": "pinterest",
        "post_title": "Summer lookbook",
        "post_description": "Summer lookbook, part 2.",
        "media_type": "image",
        "media_storage_path": "wallet_2f6a1c0e.../lookbook-2.jpg",
        "error_message": null,
        "batch_id": "f7e6d5c4-b3a2-4190-8f7e-6d5c4b3a2918",
        "created_via": "x402"
      }
    ]
  },
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa",
  "network": "base",
  "txHash": "0x6f2e8a1b...",
  "payerAddress": "0x9af31c5e..."
}`,
          },
        ],
      },
      {
        id: "history",
        method: "GET",
        path: "/api/x402/history",
        title: "List content history",
        description:
          "Charges list_history. Returns published content records for the wallet.",
        sourceRef: "src/app/api/x402/history/route.ts",
        paramTables: [
          {
            heading: "Query Parameters",
            rows: [
              {
                name: "platform",
                type: "string",
                required: false,
                description:
                  "Any of linkedin, tiktok, pinterest, instagram, facebook, threads, youtube, x.",
              },
              {
                name: "limit",
                type: "number",
                required: false,
                description: "1 to 100. Default 20.",
              },
            ],
          },
          {
            heading: "Response Fields (data.history[])",
            rows: [
              {
                name: "id",
                type: "string",
                required: true,
                description: "History record id.",
              },
              {
                name: "platform",
                type: "string",
                required: true,
                description: "Platform the content went to.",
              },
              {
                name: "content_id",
                type: "string",
                required: true,
                description: "Platform-side content identifier.",
              },
              {
                name: "title",
                type: "string | null",
                required: true,
                description: "Title, when set.",
              },
              {
                name: "description",
                type: "string | null",
                required: true,
                description: "Body text, when set.",
              },
              {
                name: "media_url",
                type: "string | null",
                required: true,
                description: "Public media URL, when available.",
              },
              {
                name: "media_type",
                type: "string | null",
                required: true,
                description: "text, image, or video.",
              },
              {
                name: "status",
                type: "string | null",
                required: true,
                description: "Platform-side publish status.",
              },
              {
                name: "created_via",
                type: "string",
                required: true,
                description: "x402 for content created through this API.",
              },
              {
                name: "created_at",
                type: "string",
                required: true,
                description: "Record creation time.",
              },
            ],
          },
        ],
        codeSamples: [
          {
            label: "Example Request",
            code: `curl "https://sharetopus.com/api/x402/history?platform=tiktok&limit=10" \\
  -H "PAYMENT-SIGNATURE: <signed-payment-payload>"`,
          },
          {
            label: "Response · 200",
            code: `{
  "success": true,
  "data": {
    "history": [
      {
        "id": "d4c3b2a1-f6e5-4d7c-8b9a-1f2e3d4c5b6a",
        "platform": "tiktok",
        "content_id": "7361528490123456789",
        "title": null,
        "description": "Launch day.",
        "media_url": "https://...",
        "media_type": "video",
        "status": "posted",
        "created_via": "x402",
        "created_at": "2026-06-09T12:04:10.000Z"
      }
    ]
  },
  "chargeId": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa",
  "network": "base",
  "txHash": "0x6f2e8a1b...",
  "payerAddress": "0x9af31c5e..."
}`,
          },
        ],
      },
    ],
  },

  // ── Networks and assets ─────────────────────────────────────────────────
  {
    id: "networks",
    navLabel: "Networks",
    title: "Networks and assets",
    summary:
      "Four mainnet networks. The API accepts and returns short names; CAIP-2 ids appear inside 402 accepts entries and the PAYMENT-RESPONSE header.",
    sourceRef: "src/lib/x402/networks.ts, src/lib/x402/config.ts",
    table: {
      columns: ["Network", "CAIP-2 id", "USDC contract", "Decimals"],
      rows: [
        [
          "base",
          "eip155:8453",
          "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          "6",
        ],
        [
          "polygon",
          "eip155:137",
          "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
          "6",
        ],
        [
          "arbitrum",
          "eip155:42161",
          "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          "6",
        ],
        [
          "solana",
          "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "6",
        ],
      ],
    },
    tableNote:
      "Settlement runs through the Coinbase CDP facilitator. Select a network per request with ?network=; unknown values return 400 unsupported_network. Default: base.",
  },

  // ── Pricing ─────────────────────────────────────────────────────────────
  {
    id: "pricing",
    navLabel: "Pricing",
    title: "Pricing",
    summary:
      "Current USDC price per action, read live from the pricing table.",
    sourceRef:
      "pricing_actions table via data/pricing.ts; runtime rule in src/lib/x402/pricing/readActionPrice.ts",
  },

  // ── Error codes ─────────────────────────────────────────────────────────
  {
    id: "errors",
    navLabel: "Errors",
    title: "Error codes",
    summary:
      "Status codes and error codes the surface actually produces. The code is the error field in the response body.",
    sourceRef:
      "src/lib/x402/responses/buildErrorResponse.ts, src/lib/x402/middleware/x402PaidEndpoint.ts (status mappers), route handlers",
    table: {
      columns: ["Status", "Code", "Meaning"],
      rows: [
        [
          "400",
          "validation_error, invalid_json",
          "Body failed schema validation or is not valid JSON.",
        ],
        [
          "400",
          "unsupported_network",
          "?network is not base, polygon, arbitrum, or solana.",
        ],
        [
          "400",
          "invalid_platform, invalid_post_type, invalid_status, invalid_limit",
          "A query or body enum value is out of range.",
        ],
        [
          "400",
          "malformed_payment, invalid_payment_signature",
          "PAYMENT-SIGNATURE is not valid base64 JSON, or its signature failed verification.",
        ],
        [
          "400",
          "missing_body, malformed_body, siwe_parse_failed",
          "Register verify body is missing, malformed, or unparsable.",
        ],
        [
          "401",
          "missing_authorization, invalid_token, token_expired",
          "Status polling without a valid Bearer connection token.",
        ],
        [
          "401",
          "siwe_domain_mismatch, siwe_address_mismatch, siwe_chain_mismatch, siwe_uri_mismatch, siwe_nonce_invalid, siwe_expired, siwe_not_yet_valid, siwe_invalid_signature",
          "A sign-in field or signature check failed during register. Mismatch bodies carry expected and received.",
        ],
        [
          "402",
          "(payment required)",
          "No payment attached. Body and the PAYMENT-REQUIRED header carry the accepts array.",
        ],
        [
          "402",
          "verify_amount_mismatch, verify_network_mismatch, verify_recipient_mismatch",
          "The signed payment does not match the required amount, network, or recipient.",
        ],
        [
          "402",
          "insufficient_funds",
          "Settlement failed: payer balance too low.",
        ],
        [
          "402",
          "wallet_not_registered",
          "Paying wallet is not registered. Register first. The connect route returns 401 with the same code.",
        ],
        [
          "403",
          "sanctioned",
          "Wallet or payer flagged by sanctions screening.",
        ],
        [
          "404",
          "connection_not_found",
          "The connection token does not match a known connection.",
        ],
        [
          "409",
          "replay, replay_detected",
          "This exact payment was already presented. Sign a fresh payment.",
        ],
        [
          "429",
          "rate_limited, poll_limit_exceeded",
          "Per-IP rate limit hit, or the 720-poll connection cap exhausted.",
        ],
        [
          "500",
          "internal, pricing_not_configured, charge_insert_failed, charge_update_failed",
          "Server-side failure. When the body carries refundInitiated, a settled payment was refunded on-chain.",
        ],
        [
          "500",
          "execution_failed, quota_exceeded, account_not_found, ownership_mismatch, reauth_not_needed",
          "The paid action failed after settlement. The charge is refunded on-chain when possible (refundInitiated true).",
        ],
        [
          "502",
          "facilitator_unavailable",
          "Payment facilitator unreachable or returned an error.",
        ],
        [
          "504",
          "settlement_timeout",
          "Settlement timed out and the outcome may be indeterminate. Do not re-present the same payment; contact support if the charge settled.",
        ],
      ],
    },
    tableNote:
      "Endpoints wrapped by the shared middleware return { success: false, error, message, chargeId } plus refund fields when applicable. register, connect, and status return { error, ... } without the success field.",
    codeSamples: [
      {
        label: "Error Response Format",
        code: `{
  "success": false,
  "error": "insufficient_funds",
  "message": "Payer balance is below the required amount.",
  "chargeId": null
}`,
      },
      {
        label: "Error Format · register / connect / status",
        code: `{
  "error": "siwe_nonce_invalid",
  "reason": "already_used"
}`,
      },
    ],
  },

  // ── Rate limits ─────────────────────────────────────────────────────────
  {
    id: "rate-limits",
    navLabel: "Rate limits",
    title: "Rate limits",
    summary:
      "Per-IP sliding windows. 429 responses set the Retry-After header; no X-RateLimit headers are sent.",
    sourceRef:
      "checkRateLimit call sites under src/app/api/x402/ and src/lib/x402/; src/actions/server/rateLimit/checkRateLimit.ts",
    table: {
      columns: ["Scope", "Endpoint", "Limit", "Window"],
      rows: [
        ["x402_register_challenge", "POST /register (challenge)", "10", "60 s"],
        ["x402_register_verify", "POST /register (verify)", "5", "60 s"],
        ["x402_connect_challenge", "POST /connect (challenge)", "10", "60 s"],
        ["x402_connect_verify", "POST /connect (verify)", "5", "60 s"],
        ["x402_oauth_status_poll", "GET /oauth/status", "120", "60 s"],
        ["x402:reauth", "POST /reauth", "10", "60 s"],
        ["x402:post-now", "POST /post-now", "20", "60 s"],
        ["x402:schedule", "POST /schedule", "10", "60 s"],
        ["x402:upload-url", "POST /upload-url", "20", "60 s"],
        ["x402:reschedule", "POST /reschedule", "30", "60 s"],
        ["x402:cancel", "POST /cancel", "30", "60 s"],
        ["x402:delete", "POST /delete", "30", "60 s"],
        ["x402:connections", "GET /connections", "60", "60 s"],
        ["x402:scheduled-posts", "GET /scheduled-posts", "60", "60 s"],
        ["x402:history", "GET /history", "60", "60 s"],
        [
          "x402_oauth_callback",
          "GET /api/oauth/callback/<platform>",
          "60",
          "60 s",
        ],
      ],
    },
    tableNote:
      "All limits are keyed per client IP. Separately, each connection accepts at most 720 status polls over its lifetime (429 poll_limit_exceeded, no Retry-After header). Endpoint handlers also enforce per-wallet limits after settlement; exhausting one returns 500 with the charge refunded on-chain, not a 429.",
    codeSamples: [
      {
        label: "Response · 429",
        code: `HTTP/2 429
Retry-After: 42

{
  "success": false,
  "error": "rate_limited",
  "message": "Rate limit exceeded. Please try again later.",
  "chargeId": null
}`,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export const SIDEBAR_ITEMS = [
  { id: "overview", label: "Overview" },
  ...DOCS_SECTIONS.map((section) => ({
    id: section.id,
    label: section.navLabel,
  })),
];
