import "server-only";

import { createHash } from "node:crypto";
import { WebSocket } from "undici";
import { schnorr } from "@noble/curves/secp256k1.js";

import type {
  ProviderBehavior,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
} from "./types";

/**
 * Nostr provider. The credential is the account's secp256k1 private key
 * (hex); events are signed locally per NIP-01 (schnorr over the sha256 of
 * the canonical serialization) and published to the user's relays over
 * WebSocket. undici's WebSocket keeps this independent of the runtime's
 * global availability.
 *
 * The key never leaves this process: connect only derives the public key,
 * and publish signs locally. Success requires at least one relay OK.
 *
 * sourceRef: NIP-01 (event id serialization, EVENT/OK messages).
 */

/** 32-byte hex key. nsec bech32 is deliberately not accepted; the help
 * text tells the user to convert, which keeps decoding surface out. */
const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/;
const RELAY_TIMEOUT_MS = 10_000;
const MAX_RELAYS = 5;

function parseRelayList(rawRelays: string): string[] {
  return rawRelays
    .split(/[\s,]+/)
    .map((relay) => relay.trim())
    .filter((relay) => relay.length > 0)
    .slice(0, MAX_RELAYS);
}

function isValidRelayUrl(relayUrl: string): boolean {
  try {
    const parsed = new URL(relayUrl);
    return parsed.protocol === "wss:";
  } catch {
    return false;
  }
}

async function connect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return { ok: false, message: "Nostr connects with a private key." };
  }
  const privateKeyHex = (input.values.privateKey ?? "").trim().toLowerCase();
  if (!HEX_KEY_PATTERN.test(privateKeyHex)) {
    return {
      ok: false,
      message:
        "Private key must be 64 hex characters. Convert an nsec key to hex first.",
    };
  }
  const relays = parseRelayList(input.values.relays ?? "");
  if (relays.length === 0 || !relays.every(isValidRelayUrl)) {
    return {
      ok: false,
      message: "At least one wss:// relay URL is required.",
    };
  }

  let publicKeyHex: string;
  try {
    // @noble/curves v2 takes byte arrays, not hex strings.
    publicKeyHex = Buffer.from(
      schnorr.getPublicKey(Buffer.from(privateKeyHex, "hex")),
    ).toString("hex");
  } catch {
    return { ok: false, message: "That private key is not a valid secp256k1 key." };
  }

  return {
    ok: true,
    accessToken: privateKeyHex,
    refreshToken: null,
    expiresIn: null,
    identity: {
      accountIdentifier: publicKeyHex,
      displayName: `npub ${publicKeyHex.slice(0, 12)}...`,
      username: null,
      avatarUrl: null,
    },
    config: { relays: relays.join(",") },
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const relays = parseRelayList(
    typeof input.config.relays === "string" ? input.config.relays : "",
  ).filter(isValidRelayUrl);
  if (relays.length === 0) {
    return { ok: false, message: "Stored Nostr account has no relays." };
  }
  if (!HEX_KEY_PATTERN.test(input.accessToken)) {
    return { ok: false, message: "Stored Nostr key is invalid. Reconnect." };
  }

  const content = [input.title.trim(), input.body.trim()]
    .filter((part) => part.length > 0)
    .join("\n\n")
    .concat(input.mediaUrl ? `\n${input.mediaUrl}` : "");

  const privateKeyBytes = Buffer.from(input.accessToken, "hex");
  const publicKeyHex = Buffer.from(
    schnorr.getPublicKey(privateKeyBytes),
  ).toString("hex");
  const createdAt = Math.floor(Date.now() / 1000);
  const tags: string[][] = [];

  // NIP-01 canonical serialization; its sha256 is both the event id and
  // the message that gets signed.
  const serialized = JSON.stringify([
    0,
    publicKeyHex,
    createdAt,
    1,
    tags,
    content,
  ]);
  const eventId = createHash("sha256").update(serialized, "utf-8").digest();
  const signature = Buffer.from(
    schnorr.sign(eventId, privateKeyBytes),
  ).toString("hex");

  const signedEvent = {
    id: eventId.toString("hex"),
    pubkey: publicKeyHex,
    created_at: createdAt,
    kind: 1,
    tags,
    content,
    sig: signature,
  };

  const relayOutcomes = await Promise.all(
    relays.map((relayUrl) => publishToRelay(relayUrl, signedEvent)),
  );
  const acceptedCount = relayOutcomes.filter(
    (outcome) => outcome.accepted,
  ).length;

  if (acceptedCount === 0) {
    const firstReason = relayOutcomes[0]?.reason ?? "no relay reachable";
    return {
      ok: false,
      message: `No relay accepted the note (${firstReason}).`,
    };
  }

  return { ok: true, postId: signedEvent.id, postUrl: null };
}

type RelayOutcome = { accepted: boolean; reason: string };

/** Sends ["EVENT", event] and waits for the matching ["OK", id, bool]. */
function publishToRelay(
  relayUrl: string,
  signedEvent: { id: string },
): Promise<RelayOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: RelayOutcome) => {
      if (settled) return;
      settled = true;
      try {
        relaySocket.close();
      } catch {
        // Already closed.
      }
      resolve(outcome);
    };

    let relaySocket: WebSocket;
    try {
      relaySocket = new WebSocket(relayUrl);
    } catch (socketError) {
      resolve({
        accepted: false,
        reason:
          socketError instanceof Error ? socketError.message : "socket error",
      });
      return;
    }

    const timeoutHandle = setTimeout(
      () => settle({ accepted: false, reason: "relay timeout" }),
      RELAY_TIMEOUT_MS,
    );

    relaySocket.addEventListener("open", () => {
      relaySocket.send(JSON.stringify(["EVENT", signedEvent]));
    });
    relaySocket.addEventListener("message", (messageEvent) => {
      try {
        const frame = JSON.parse(String(messageEvent.data));
        if (
          Array.isArray(frame) &&
          frame[0] === "OK" &&
          frame[1] === signedEvent.id
        ) {
          clearTimeout(timeoutHandle);
          settle({
            accepted: frame[2] === true,
            reason: typeof frame[3] === "string" ? frame[3] : "rejected",
          });
        }
      } catch {
        // Non-JSON frame; keep waiting until timeout.
      }
    });
    relaySocket.addEventListener("error", () => {
      clearTimeout(timeoutHandle);
      settle({ accepted: false, reason: "relay connection failed" });
    });
    relaySocket.addEventListener("close", () => {
      clearTimeout(timeoutHandle);
      settle({ accepted: false, reason: "relay closed early" });
    });
  });
}

export const nostrBehavior: ProviderBehavior = { connect, publish };
