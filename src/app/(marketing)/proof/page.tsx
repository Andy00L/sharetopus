import type { Metadata } from "next";

import Navbar from "@/components/marketing-page/nav-bar/nav-bar";
import Footer from "@/components/marketing-page/footer";
import { Callout } from "@/components/apiReference/Callout";
import { CodeCard } from "@/components/apiReference/CodeCard";
import { ExplorerLink } from "@/components/proof/ExplorerLink";
import { LatestReceipt } from "@/components/proof/LatestReceipt";
import type { ReceiptState } from "@/components/proof/LatestReceipt";
import { ProofLedgerTable } from "@/components/proof/ProofLedgerTable";
import { truncateMiddle } from "@/components/proof/ledgerFormat";
import { getRecipientAddress } from "@/lib/x402/config";
import { getNetworkConfig } from "@/lib/x402/networks";
import {
  buildExplorerAddressUrl,
  networkDisplayName,
} from "@/lib/x402/proof/explorer";
import { loadProofLedger } from "@/lib/x402/proof/proofLedger";

// A settlement lands on-chain in seconds and its post publishes shortly
// after; thirty seconds keeps the page honest for someone refreshing while
// bounding the read load on a public, unauthenticated route.
export const revalidate = 30;

export const metadata: Metadata = {
  title: "Proof | Sharetopus",
  description:
    "Live ledger of x402 settlements across every network Sharetopus accepts: the USDC an agent paid, the action it bought, and whether the post went live.",
};

// The calls a judge can run themselves. Mirrors demo/x402-demo.mjs.
const WAY_IN_COMMANDS = `cd demo && npm install

# Solana: the wallet signs, the CDP facilitator pays the network fee
export X402_NETWORK=solana
export SOLANA_PRIVATE_KEY=<base58 secret key of a wallet holding USDC>

# Arc: the wallet signs, Sharetopus settles it and pays the gas
export X402_NETWORK=arc
export EVM_PRIVATE_KEY=<0x key of a wallet holding USDC on Arc>

node x402-demo.mjs challenge
node x402-demo.mjs connect linkedin
node x402-demo.mjs post <social_account_id> linkedin "Posted by an agent, paid in USDC"`;

/**
 * Public proof across every network. Server component: reads the ledger
 * through the service-role client (only on-chain-public columns leave the
 * loader) and composes the page from the marketing shell and the reference
 * family's cards. Layout and tokens: docs/UI_DESIGN_SYSTEM.md, "The proof
 * ledger".
 */
export default async function ProofPage() {
  const ledgerResult = await loadProofLedger();

  const receiptState: ReceiptState = !ledgerResult.ok
    ? { kind: "unavailable" }
    : ledgerResult.entries.length === 0
      ? { kind: "empty" }
      : { kind: "entry", entry: ledgerResult.entries[0] };

  // Only lanes that actually took a payment are advertised here, so the page
  // never claims a network no agent has ever settled on.
  const provenNetworkNames = ledgerResult.ok
    ? [...new Set(ledgerResult.entries.map((entry) => entry.network))]
    : [];
  const laneFacts = provenNetworkNames
    .map((networkName) => {
      const network = getNetworkConfig(networkName);
      if (!network) return null;
      const payToAddress = getRecipientAddress(network);
      if (!payToAddress) return null;
      return { networkName, caipNetwork: network.caipNetwork, payToAddress };
    })
    .filter((fact): fact is NonNullable<typeof fact> => fact !== null);

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 pt-12 pb-16 sm:px-6 md:pt-16 lg:px-8">
          <header className="border-b border-border pb-10">
            <p className="t-eyebrow mb-3">Proof</p>
            <h1 className="font-display mb-3 text-4xl text-foreground">
              Every payment, and what it bought.
            </h1>
            <p className="t-body max-w-2xl">
              x402 settlements across every network Sharetopus accepts, newest
              first: the USDC an agent paid, the action it paid for, and
              whether the post went live. Every transaction opens on that
              network&apos;s explorer.
            </p>
            {laneFacts.length > 0 && (
              <dl className="mt-6 flex flex-wrap gap-2">
                {laneFacts.map((fact) => (
                  <div
                    key={fact.networkName}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                  >
                    <dt className="text-[var(--ink-2)]">
                      {networkDisplayName(fact.networkName)}
                    </dt>
                    <dd className="font-mono text-[12px] text-foreground">
                      <ExplorerLink
                        href={buildExplorerAddressUrl(
                          fact.networkName,
                          fact.payToAddress,
                        )}
                        title={fact.payToAddress}
                        ariaLabel={`Open the ${networkDisplayName(fact.networkName)} recipient ${fact.payToAddress} on its explorer`}
                      >
                        {truncateMiddle(fact.payToAddress, 6, 6)}
                      </ExplorerLink>
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
                Any agent holding USDC can be the next row. No account, no API
                key: the wallet signs, and on Arc, Sharetopus settles the
                authorization and pays the gas itself.
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
                No settlement recorded yet. The first row appears within a
                minute of the first paid call.
              </p>
            ) : (
              <ProofLedgerTable entries={ledgerResult.entries} showNetwork />
            )}
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
