import "server-only";

import { NextResponse } from "next/server";

import {
  buildActionHeaders,
  buildActionsPreflightResponse,
} from "@/lib/solanaActions/headers";

// Solana Actions spec (@solana/actions-spec ActionsJson): Blink clients read
// /actions.json at the origin root to learn which paths serve Actions.

export const runtime = "nodejs";
export const dynamic = "force-static";

const ACTIONS_JSON = {
  rules: [{ pathPattern: "/api/actions/**", apiPath: "/api/actions/**" }],
};

export function GET() {
  return NextResponse.json(ACTIONS_JSON, { headers: buildActionHeaders() });
}

export function OPTIONS() {
  return buildActionsPreflightResponse();
}
