import "server-only";

import { createHash } from "node:crypto";
import { WebSocket } from "undici";
import { schnorr } from "@noble/curves/secp256k1.js";

import {
  acquirePinnedDispatcher,
  resolveHostToPublicAddresses,
} from "@/lib/net/pinnedFetch";

import type {
  CredentialsConnectInput,
  ProviderBehavior,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
} from "./types";
import { failPublish, refusePublish } from "./_shared/publishFailure";
import { joinTitleAndBody } from "./_shared/postText";
import { parseJsonBody } from "./_shared/providerFetch";

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
  input: CredentialsConnectInput,
): Promise<ProviderConnectResult> {
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
    return refusePublish("Stored Nostr account has no relays.");
  }
  if (!HEX_KEY_PATTERN.test(input.accessToken)) {
    return refusePublish("Stored Nostr key is invalid. Reconnect.");
  }

  const content = joinTitleAndBody(input).concat(input.mediaUrl ? `\n${input.mediaUrl}` : "");

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
  if (relayOutcomes.some((outcome) => outcome.kind === "accepted")) {
    return { ok: true, postId: signedEvent.id, postUrl: null };
  }

  const firstReason = relayOutcomes[0]?.reason ?? "no relay reachable";
  const message = `No relay accepted the note (${firstReason}).`;
  if (relayOutcomes.some((outcome) => outcome.kind === "unconfirmed")) {
    return failPublish({ message, reason: "unknown", mayHavePublished: true });
  }
  if (relayOutcomes.some((outcome) => outcome.kind === "refused")) {
    return failPublish({ message, reason: "policy_rejected", mayHavePublished: false });
  }
  return failPublish({ message, reason: "transient", mayHavePublished: false });
}

type RelayOutcome =
  | { kind: "accepted"; reason: string }
  | { kind: "refused"; reason: string }
  | { kind: "unconfirmed"; reason: string }
  | { kind: "not_sent"; reason: string };

/** Sends ["EVENT", event] and waits for the matching ["OK", id, bool]. */
async function publishToRelay(
  relayUrl: string,
  signedEvent: { id: string },
): Promise<RelayOutcome> {
  const resolution = await resolveHostToPublicAddresses(new URL(relayUrl).hostname);
  if (!resolution.ok) {
    return { kind: "not_sent", reason: `relay host not permitted (${resolution.reason})` };
  }
  const pinnedDispatcher = acquirePinnedDispatcher(resolution.addresses);

  return new Promise((resolve) => {
    let settled = false;
    let isEventSent = false;
    const failUnanswered = (reason: string): RelayOutcome =>
      isEventSent ? { kind: "unconfirmed", reason } : { kind: "not_sent", reason };
    const settle = (outcome: RelayOutcome) => {
      if (settled) return;
      settled = true;
      relaySocket.close();
      resolve(outcome);
    };

    let relaySocket: WebSocket;
    try {
      relaySocket = new WebSocket(relayUrl, { dispatcher: pinnedDispatcher });
    } catch (socketError) {
      resolve({
        kind: "not_sent",
        reason:
          socketError instanceof Error ? socketError.message : "socket error",
      });
      return;
    }

    const timeoutHandle = setTimeout(
      () => settle(failUnanswered("relay timeout")),
      RELAY_TIMEOUT_MS,
    );

    relaySocket.addEventListener("open", () => {
      relaySocket.send(JSON.stringify(["EVENT", signedEvent]));
      isEventSent = true;
    });
    relaySocket.addEventListener("message", (messageEvent) => {
      const frame = parseJsonBody(String(messageEvent.data));
      if (Array.isArray(frame) && frame[0] === "OK" && frame[1] === signedEvent.id) {
        clearTimeout(timeoutHandle);
        const relayReason = typeof frame[3] === "string" ? frame[3] : "rejected";
        settle({ kind: frame[2] === true ? "accepted" : "refused", reason: relayReason });
      }
    });
    relaySocket.addEventListener("error", () => {
      clearTimeout(timeoutHandle);
      settle(failUnanswered("relay connection failed"));
    });
    relaySocket.addEventListener("close", () => {
      clearTimeout(timeoutHandle);
      settle(failUnanswered("relay closed early"));
    });
  });
}

export const nostrBehavior = {
  authKind: "credentials",
  connect,
  publish,
} satisfies ProviderBehavior;
