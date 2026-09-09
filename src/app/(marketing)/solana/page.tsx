import type { Metadata } from "next";

import Navbar from "@/components/marketing-page/nav-bar/nav-bar";
import Footer from "@/components/marketing-page/footer";
import { Callout } from "@/components/apiReference/Callout";
import { CodeCard } from "@/components/apiReference/CodeCard";
import { ExplorerLink } from "@/components/solana/ExplorerLink";
import { LatestReceipt } from "@/components/solana/LatestReceipt";
import type { ReceiptState } from "@/components/solana/LatestReceipt";
import { SolanaLedgerTable } from "@/components/solana/SolanaLedgerTable";
import { truncateMiddle } from "@/components/solana/ledgerFormat";
import { getRecipientAddress } from "@/lib/x402/config";
import { NETWORKS } from "@/lib/x402/networks";
import { buildSolanaExplorerAddressUrl } from "@/lib/x402/solana/explorer";
import { loadSolanaProofLedger } from "@/lib/x402/solana/proofLedger";

// A settlement lands on-chain in seconds and its post publishes shortly
// after; thirty seconds keeps the page honest for someone refreshing while
// bounding the read load on a public, unauthenticated route.
export const revalidate = 30;

export const metadata: Metadata = {
  title: "Solana lane | Sharetopus",
  description:
    "Live ledger of x402 settlements on Solana mainnet: every USDC payment an agent made, the action it bought, and whether the post went live.",
};

// The calls a judge can run themselves. Mirrors demo/x402-demo.mjs; the
// last line is the Blink, for a wallet with no code at all.
const WAY_IN_COMMANDS = `cd demo && npm install
export SOLANA_PRIVATE_KEY=<base58 secret key of a wallet holding USDC>

node x402-demo.mjs challenge
node x402-demo.mjs connect linkedin
node x402-demo.mjs post <social_account_id> linkedin "Posted by an agent, paid in USDC"

# Or from a wallet, no code: open this Blink with your connected account id
https://dial.to/?action=solana-action:https://sharetopus.com/api/actions/post-now?account_id=<social_account_id>&platform=linkedin`;

/**
 * Public proof of the Solana lane. Server component: reads the ledger
 * through the service-role client (only on-chain-public columns leave the
 * loader) and composes the page from the marketing shell and the reference
 * family's cards. Layout and tokens: docs/UI_DESIGN_SYSTEM.md, "The Solana
 * proof ledger".
 */
export default async function SolanaLanePage() {
  const ledgerResult = await loadSolanaProofLedger();
  const solanaNetwork = NETWORKS.solana ?? null;
  const payToAddress = solanaNetwork ? getRecipientAddress(solanaNetwork) : null;

  const receiptState: ReceiptState = !ledgerResult.ok
    ? { kind: "unavailable" }
    : ledgerResult.entries.length === 0
      ? { kind: "empty" }
      : { kind: "entry", entry: ledgerResult.entries[0] };

  const laneFacts: { label: string; value: string; explorerAddress?: string }[] = [];
  if (solanaNetwork) {
    laneFacts.push({ label: "Network", value: solanaNetwork.caipNetwork });
    laneFacts.push({
      label: "USDC mint",
      value: solanaNetwork.usdcAddress,
      explorerAddress: solanaNetwork.usdcAddress,
    });
  }
  if (payToAddress) {
    laneFacts.push({
      label: "Pay to",
      value: payToAddress,
      explorerAddress: payToAddress,
    });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 pt-12 pb-16 sm:px-6 md:pt-16 lg:px-8">
          <header className="border-b border-border pb-10">
            <p className="t-eyebrow mb-3">Solana lane</p>
            <h1 className="font-display mb-3 text-4xl text-foreground">
              Every Solana payment, and what it bought.
            </h1>
            <p className="t-body max-w-2xl">
              x402 settlements on Solana mainnet, newest first: the USDC an
              agent paid, the action it paid for, and whether the post went
              live. Every signature opens on Solana Explorer.
            </p>
            {laneFacts.length > 0 && (
              <dl className="mt-6 flex flex-wrap gap-2">
                {laneFacts.map((fact) => (
                  <div
                    key={fact.label}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                  >
                    <dt className="text-[var(--ink-2)]">{fact.label}</dt>
                    <dd className="font-mono text-[12px] text-foreground">
                      {fact.explorerAddress ? (
                        <ExplorerLink
                          href={buildSolanaExplorerAddressUrl(fact.explorerAddress)}
                          title={fact.value}
                          ariaLabel={`Open ${fact.label} ${fact.value} on Solana Explorer`}
                        >
                          {truncateMiddle(fact.value, 8, 8)}
                        </ExplorerLink>
                      ) : (
                        fact.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </header>

          <section className="grid gap-8 py-10 md:grid-cols-2 md:items-start">
            <LatestReceipt state={receiptState} />
            <div>
              <p className="mb-3 text-sm text-[var(--ink-2)]">
                Any agent with USDC on Solana can be the next row. No account,
                no API key: the wallet signs, the facilitator pays the fee.
              </p>
              <CodeCard label="The way in" code={WAY_IN_COMMANDS} />
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-bold tracking-tight text-foreground">
              Ledger
            </h2>
            {!ledgerResult.ok ? (
              <Callout tone="amber">
                The ledger could not be read right now. Settlements still
                verify on-chain; try again in a minute.
              </Callout>
            ) : ledgerResult.entries.length === 0 ? (
              <p className="text-sm text-[var(--ink-2)]">
                No Solana settlement recorded yet. The first row appears within
                a minute of the first paid call.
              </p>
            ) : (
              <SolanaLedgerTable entries={ledgerResult.entries} />
            )}
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
