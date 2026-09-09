import "server-only";

import { NextResponse } from "next/server";

import {
  buildActionHeaders,
  buildActionsPreflightResponse,
} from "@/lib/solanaActions/headers";

/**
 * GET /actions.json
 *
 * Solana Actions discovery file: tells Blink clients which paths on this
 * origin serve Actions. The API routes map to themselves, so a Blink URL is
 * simply the API URL (for example
 * https://dial.to/?action=solana-action:https://sharetopus.com/api/actions/post-now?account_id=...).
 *
 * sourceRef: @solana/actions-spec v2.4.2 ActionsJson
 */

export const runtime = "nodejs";

const ACTIONS_JSON = {
  rules: [{ pathPattern: "/api/actions/**", apiPath: "/api/actions/**" }],
};

export function GET() {
  return NextResponse.json(ACTIONS_JSON, { headers: buildActionHeaders() });
}

export function OPTIONS() {
  return buildActionsPreflightResponse();
}
