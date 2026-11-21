import "server-only";

import { createHash } from "node:crypto";

import { redis } from "@/actions/api/upstash";

const PAID_ROUTE_MAX_DURATION_MS = 60_000;

export const KEY_RESERVATION_TTL_MS = 2 * PAID_ROUTE_MAX_DURATION_MS;

export type KeyReservation =
  | { kind: "reserved"; release: () => Promise<void> }
  | { kind: "no_key" }
  | { kind: "held" }
  | { kind: "unavailable"; message: string };

function buildReservationKey(params: {
  endpointPath: string;
  principalId: string;
  idempotencyKey: string;
}): string {
  const idempotencyKeyDigest = createHash("sha256").update(params.idempotencyKey).digest("hex");
  return `x402_idempotency_reservation:${params.endpointPath}:${params.principalId}:${idempotencyKeyDigest}`;
}

export async function reserveIdempotencyKey(params: {
  endpointPath: string;
  principalId: string;
  idempotencyKey: string | undefined;
  requestId: string;
}): Promise<KeyReservation> {
  if (!params.idempotencyKey) return { kind: "no_key" };
  const reservationKey = buildReservationKey({
    endpointPath: params.endpointPath,
    principalId: params.principalId,
    idempotencyKey: params.idempotencyKey,
  });
  try {
    const reply = await redis.set(reservationKey, params.requestId, {
      nx: true,
      px: KEY_RESERVATION_TTL_MS,
    });
    if (reply !== "OK") return { kind: "held" };
  } catch (error) {
    return { kind: "unavailable", message: error instanceof Error ? error.message : String(error) };
  }
  return { kind: "reserved", release: () => releaseReservation(reservationKey) };
}

async function releaseReservation(reservationKey: string): Promise<void> {
  try {
    await redis.del(reservationKey);
  } catch (error) {
    console.error(
      `[releaseReservation] Release failed for ${reservationKey}; it expires within ${KEY_RESERVATION_TTL_MS} ms:`,
      error instanceof Error ? error.message : error,
    );
  }
}
