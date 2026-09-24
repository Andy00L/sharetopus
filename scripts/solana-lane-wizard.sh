#!/usr/bin/env bash
# Solana lane wizard: the steps only a human can do after the code shipped.
#
# Stages:
#   1  pin a dedicated Solana RPC (local .env and Vercel)
#   2  prepare and fund the agent wallet (demo/.env)
#   3  the recorded mainnet run: challenge, connect, post, explorer link
#   4  the Blink: try it on dial.to, register the domain for wallet unfurls
#
# Usage: bash scripts/solana-lane-wizard.sh
# One-off: delete it once the grant run is recorded. Secrets are entered
# hidden and written only to gitignored .env files (.env* rule).

set -euo pipefail

TOTAL_STAGES=4
CURRENT_STAGE=0
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_ENV="$ROOT_DIR/.env"
DEMO_ENV="$ROOT_DIR/demo/.env"
SUMMARY=()

# ---------- library ----------

say() { printf '%s\n' "$*"; }
step() { printf '  -> %s\n' "$*"; }

stage() {
  CURRENT_STAGE=$((CURRENT_STAGE + 1))
  clear 2>/dev/null || true
  say "==================================================================="
  say " Solana lane wizard  |  stage $CURRENT_STAGE of $TOTAL_STAGES  |  $1"
  say "==================================================================="
  say ""
}

# Cross-platform URL opener: macOS, Git Bash on Windows, WSL, desktop Linux.
open_url() {
  local url="$1"
  say "Opening: $url"
  case "$(uname -s)" in
    Darwin) open "$url" ;;
    MINGW*|MSYS*|CYGWIN*) cmd.exe //c start "" "$url" ;;
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        if command -v wslview >/dev/null 2>&1; then wslview "$url"; else cmd.exe /c start "" "$url"; fi
      else
        xdg-open "$url" >/dev/null 2>&1 || say "(open it manually)"
      fi ;;
    *) say "(open it manually)" ;;
  esac
}

# read -p writes the prompt to stderr, so $(ask ...) captures only the reply.
ask() { local reply; read -r -p "$1: " reply; printf '%s' "$reply"; }
ask_secret() { local reply; read -r -s -p "$1 (hidden): " reply; printf '\n' >&2; printf '%s' "$reply"; }
confirm() { local reply; read -r -p "$1 [y/N]: " reply; [[ "$reply" =~ ^[Yy]$ ]]; }
pause() { read -r -p "Press Enter when done... " _; }

# Idempotent KEY=VALUE upsert into an env file. Values are written verbatim.
write_env() {
  local file="$1" key="$2" value="$3" tmp
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    tmp="$(mktemp)"
    grep -v "^${key}=" "$file" > "$tmp" || true
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
  SUMMARY+=("$key -> $file")
}

# ---------- stages ----------

stage "Pin a dedicated Solana RPC"
say "Refunds and the Blink read blockhashes and transactions on Solana. The"
say "public endpoint (api.mainnet-beta.solana.com) is rate-limited; pin a"
say "provider URL (Helius, QuickNode, Triton, or similar)."
step "Create a mainnet RPC endpoint at your provider and copy the full https URL."
step "It usually carries the API key in the URL, so treat it as a secret."
RPC_URL="$(ask_secret "Paste X402_SOLANA_RPC_URL")"
case "$RPC_URL" in
  https://*) ;;
  *) say "The URL must start with https://. Aborting."; exit 1 ;;
esac
write_env "$ROOT_ENV" X402_SOLANA_RPC_URL "$RPC_URL"
say ""
say "Now the same value on Vercel:"
open_url "https://vercel.com/dashboard"
step "Project sharetopus -> Settings -> Environment Variables -> Add"
step "Key X402_SOLANA_RPC_URL, the URL as value, environments Production and Preview."
step "Deployments -> latest -> Redeploy, so the running functions pick it up."
pause

stage "Prepare and fund the agent wallet"
say "The demo pays from a plain keypair. Use a fresh wallet, never your main one."
step "Phantom: Settings -> Security & Privacy -> Export Private Key (base58),"
step "or from a terminal: solana-keygen new -o agent.json (paste the JSON array)."
step "Fund it with at least 2 USDC (SPL, Solana mainnet) for the demo run."
step "Add about 0.01 SOL only if this wallet will also test the Blink (Blink payments pay their own fee)."
WALLET_KEY="$(ask_secret "Paste SOLANA_PRIVATE_KEY (base58 or JSON byte array)")"
if [ -z "$WALLET_KEY" ]; then say "Empty key. Aborting."; exit 1; fi
write_env "$DEMO_ENV" SOLANA_PRIVATE_KEY "$WALLET_KEY"
if confirm "Also pin a dedicated RPC for the demo client (optional, avoids public rate limits)?"; then
  CLIENT_RPC="$(ask_secret "Paste SOLANA_RPC_URL for the demo client")"
  write_env "$DEMO_ENV" SOLANA_RPC_URL "$CLIENT_RPC"
fi
say ""
say "demo/.env is gitignored. Load it before each demo command:"
say "  set -a; source demo/.env; set +a"
pause

stage "The recorded mainnet run"
say "Start recording, then run these from the repo root. Lines marked PAID spend real USDC."
say ""
say "  cd demo && bun install && cd .."
say "  set -a; source demo/.env; set +a"
say "  node demo/x402-demo.mjs challenge                          # free: the Solana 402"
say "  node demo/x402-demo.mjs connect linkedin                   # PAID 0.50: oauthUrl + connectionToken"
say "  (open oauthUrl in a browser and authorize)"
say "  node demo/x402-demo.mjs status <connectionToken>           # free"
say "  node demo/x402-demo.mjs accounts                           # PAID 0.001: social_account_id"
say "  node demo/x402-demo.mjs post <social_account_id> linkedin \"Posted by an agent, paid in USDC on Solana\"   # PAID 0.50"
say ""
step "The post command prints 'Explorer: https://explorer.solana.com/tx/...'. Keep that link."
ACCOUNT_ID="$(ask "Paste the social_account_id from 'accounts'")"
if [ -n "$ACCOUNT_ID" ]; then write_env "$DEMO_ENV" SOCIAL_ACCOUNT_ID "$ACCOUNT_ID"; fi
EXPLORER_LINK="$(ask "Paste the explorer link of the post payment")"
SUMMARY+=("explorer link -> $EXPLORER_LINK")
open_url "https://sharetopus.com/solana"
step "The settlement is the latest receipt; the post shows Published within a minute."
pause

stage "The Blink"
BLINK_API="https://sharetopus.com/api/actions/post-now?account_id=${ACCOUNT_ID:-<social_account_id>}&platform=linkedin"
BLINK_URL="https://dial.to/?action=solana-action:${BLINK_API}"
say "Your Blink (works on dial.to today, no registration needed):"
say "  $BLINK_URL"
SUMMARY+=("blink -> $BLINK_URL")
open_url "$BLINK_URL"
step "Connect the SAME wallet that ran the demo: a wallet Sharetopus has never seen is refused before paying."
step "Type a post, approve the 0.50 USDC transaction; the completed card shows the explorer link."
say ""
say "For Phantom, X, and other clients to unfurl the Blink, the domain must be in"
say "the Dialect registry. That form is theirs and moves; verify the path:"
step "Open https://dial.to and look for Register, or start from https://docs.dialect.to."
step "Submit sharetopus.com. Review takes time; dial.to keeps working meanwhile."
pause

clear 2>/dev/null || true
say "Done. What this wizard wrote:"
for line in "${SUMMARY[@]:-}"; do say "  $line"; done
say ""
say "Delete this script once the run is recorded: it is a one-off."
