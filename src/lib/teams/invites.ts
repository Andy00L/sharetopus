import "server-only";

import { randomBytes } from "node:crypto";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { hashToken } from "@/lib/api/tokens";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";

import { requireTeamRole } from "./membership";
import { isInvitableRole, type InvitableRole } from "./types";

/**
 * Team invite lifecycle: issue, accept, revoke.
 *
 * The raw invite token is returned exactly once, at creation, and only its
 * sha256 is stored, the same shape api_keys uses. Anyone holding the raw
 * token can join the team, so it is treated as a credential: never logged,
 * never read back, and looked up only by hash.
 *
 * Called by: the team REST routes and server actions.
 * Tables touched: team_invites (insert/update), team_members (insert).
 */

/** 32 random bytes, matching the api_keys entropy budget. */
const INVITE_TOKEN_RANDOM_BYTES = 32;

/** Invites expire after 7 days. Long enough for a real person, short
 * enough that a leaked link in an old mailbox stops working. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Per-inviter ceiling, so a compromised session cannot spray invites. */
const INVITE_RATE_LIMIT_PER_HOUR = 30;
const INVITE_RATE_LIMIT_WINDOW_SECONDS = 3600;

function generateInviteToken(): { rawToken: string; tokenHash: string } {
  const rawToken = `stp_invite_${randomBytes(INVITE_TOKEN_RANDOM_BYTES).toString("hex")}`;
  return { rawToken, tokenHash: hashToken(rawToken) };
}

/** Normalizes for the case-insensitive unique index on (team_id, email). */
function normalizeEmail(rawEmail: string): string {
  return rawEmail.trim().toLowerCase();
}

export type CreateInviteResult =
  | {
      ok: true;
      inviteId: string;
      /** Shown to the inviter ONCE. Never retrievable afterwards. */
      rawToken: string;
      expiresAt: string;
    }
  | {
      ok: false;
      reason:
        | "not_authorized"
        | "invalid_email"
        | "invalid_role"
        | "already_invited"
        | "rate_limited"
        | "insert_failed";
      message: string;
    };

/**
 * Issues an invite. Requires admin or owner in the target team.
 *
 * The returned token is the only copy: it is not stored, not logged, and
 * cannot be re-read. A lost invite is re-issued, not recovered.
 */
export async function createTeamInvite(params: {
  inviterPrincipalId: string;
  teamId: string;
  email: string;
  role: string;
}): Promise<CreateInviteResult> {
  const authorization = await requireTeamRole(
    params.inviterPrincipalId,
    params.teamId,
    "admin",
  );
  if (!authorization.ok) {
    return { ok: false, reason: "not_authorized", message: authorization.message };
  }

  if (!isInvitableRole(params.role)) {
    return {
      ok: false,
      reason: "invalid_role",
      message: "An invite can grant the member or admin role only.",
    };
  }
  const invitedRole: InvitableRole = params.role;

  const email = normalizeEmail(params.email);
  // Deliberately minimal: the address is only ever used as a label and for
  // the duplicate-invite index, never interpolated into a query or a shell.
  if (email.length < 3 || !email.includes("@") || email.startsWith("@")) {
    return {
      ok: false,
      reason: "invalid_email",
      message: "That does not look like an email address.",
    };
  }

  const rateLimit = await checkRateLimit(
    "team.invite.create",
    params.inviterPrincipalId,
    INVITE_RATE_LIMIT_PER_HOUR,
    INVITE_RATE_LIMIT_WINDOW_SECONDS,
  );
  if (!rateLimit.success) {
    return {
      ok: false,
      reason: "rate_limited",
      message: "Too many invites sent. Try again shortly.",
    };
  }

  const { rawToken, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { data: insertedInvite, error: insertError } = await adminSupabase
    .from("team_invites")
    .insert({
      team_id: params.teamId,
      email,
      role: invitedRole,
      token_hash: tokenHash,
      invited_by_principal_id: params.inviterPrincipalId,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError) {
    // 23505 on the partial unique index means a live invite already exists
    // for this address, which is a distinct, actionable outcome.
    if ((insertError as { code?: string }).code === "23505") {
      return {
        ok: false,
        reason: "already_invited",
        message: "That address already has a pending invite to this team.",
      };
    }
    console.error("[createTeamInvite] Insert failed:", insertError.message);
    return {
      ok: false,
      reason: "insert_failed",
      message: "Could not create the invite.",
    };
  }

  return {
    ok: true,
    inviteId: insertedInvite.id,
    rawToken,
    expiresAt,
  };
}

export type AcceptInviteResult =
  | { ok: true; teamId: string; role: InvitableRole; alreadyMember: boolean }
  | {
      ok: false;
      reason: "invalid_token" | "expired" | "already_used" | "join_failed";
      message: string;
    };

/**
 * Accepts an invite on behalf of the signed-in principal.
 *
 * Ordering is deliberate. The invite is claimed first with a
 * compare-and-set scoped to "still open", so two concurrent accepts of the
 * same link produce exactly one winner. Only the winner inserts the
 * membership. If that insert then fails, the claim is released so the
 * invite is usable again rather than being burned by a transient error.
 *
 * Every failure that could reveal whether a token exists collapses to
 * invalid_token: an attacker guessing tokens learns nothing from the
 * difference between "no such invite" and "expired invite".
 */
export async function acceptTeamInvite(params: {
  principalId: string;
  rawToken: string;
}): Promise<AcceptInviteResult> {
  const tokenHash = hashToken(params.rawToken.trim());

  const { data: inviteRow, error: lookupError } = await adminSupabase
    .from("team_invites")
    .select("id, team_id, role, expires_at, accepted_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (lookupError) {
    console.error("[acceptTeamInvite] Lookup failed:", lookupError.message);
    return {
      ok: false,
      reason: "join_failed",
      message: "Could not process that invite.",
    };
  }

  if (!inviteRow || inviteRow.revoked_at !== null) {
    return {
      ok: false,
      reason: "invalid_token",
      message: "That invite link is not valid.",
    };
  }

  if (inviteRow.accepted_at !== null) {
    return {
      ok: false,
      reason: "already_used",
      message: "That invite has already been used.",
    };
  }

  if (new Date(inviteRow.expires_at).getTime() <= Date.now()) {
    return {
      ok: false,
      reason: "expired",
      message: "That invite has expired. Ask for a new one.",
    };
  }

  if (!isInvitableRole(inviteRow.role)) {
    console.error(
      `[acceptTeamInvite] Invite ${inviteRow.id} carries unexpected role "${inviteRow.role}".`,
    );
    return {
      ok: false,
      reason: "join_failed",
      message: "Could not process that invite.",
    };
  }
  const grantedRole: InvitableRole = inviteRow.role;

  // Claim: scoped to still-open so a concurrent accept matches zero rows.
  const { data: claimedRows, error: claimError } = await adminSupabase
    .from("team_invites")
    .update({
      accepted_at: new Date().toISOString(),
      accepted_by_principal_id: params.principalId,
    })
    .eq("id", inviteRow.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id");

  if (claimError) {
    console.error("[acceptTeamInvite] Claim failed:", claimError.message);
    return {
      ok: false,
      reason: "join_failed",
      message: "Could not process that invite.",
    };
  }

  if (!claimedRows || claimedRows.length === 0) {
    return {
      ok: false,
      reason: "already_used",
      message: "That invite has already been used.",
    };
  }

  // Winner inserts the membership. The unique (team_id, principal_id)
  // constraint makes re-joining a no-op rather than a duplicate row.
  const { error: membershipError } = await adminSupabase
    .from("team_members")
    .upsert(
      {
        team_id: inviteRow.team_id,
        principal_id: params.principalId,
        role: grantedRole,
      },
      { onConflict: "team_id,principal_id", ignoreDuplicates: true },
    );

  if (membershipError) {
    console.error(
      `[acceptTeamInvite] Membership insert failed after claiming invite ${inviteRow.id}; releasing the claim:`,
      membershipError.message,
    );

    // Compensate: an invite burned by a transient DB error would strand
    // the invitee with no way back in.
    const { error: releaseError } = await adminSupabase
      .from("team_invites")
      .update({ accepted_at: null, accepted_by_principal_id: null })
      .eq("id", inviteRow.id);

    if (releaseError) {
      console.error(
        `[acceptTeamInvite] INVITE STUCK: ${inviteRow.id} is marked accepted but no membership exists, and the release failed: ${releaseError.message}`,
      );
    }

    return {
      ok: false,
      reason: "join_failed",
      message: "Could not add you to the team. Try the link again.",
    };
  }

  return {
    ok: true,
    teamId: inviteRow.team_id,
    role: grantedRole,
    alreadyMember: false,
  };
}

export type RevokeInviteResult =
  | { ok: true; revoked: boolean }
  | { ok: false; reason: "not_authorized" | "revoke_failed"; message: string };

/** Revokes a pending invite. Requires admin or owner in the team. */
export async function revokeTeamInvite(params: {
  principalId: string;
  teamId: string;
  inviteId: string;
}): Promise<RevokeInviteResult> {
  const authorization = await requireTeamRole(
    params.principalId,
    params.teamId,
    "admin",
  );
  if (!authorization.ok) {
    return { ok: false, reason: "not_authorized", message: authorization.message };
  }

  // Scoped to the team as well as the id so an invite id from another team
  // cannot be revoked by an admin of this one.
  const { data: revokedRows, error: revokeError } = await adminSupabase
    .from("team_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", params.inviteId)
    .eq("team_id", params.teamId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id");

  if (revokeError) {
    console.error("[revokeTeamInvite] Revoke failed:", revokeError.message);
    return {
      ok: false,
      reason: "revoke_failed",
      message: "Could not revoke that invite.",
    };
  }

  return { ok: true, revoked: (revokedRows ?? []).length > 0 };
}
