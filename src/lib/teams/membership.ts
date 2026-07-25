import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

import { isTeamRole, roleMeets, type TeamRole } from "./types";

/**
 * Team authorization primitive. Every team-scoped action calls
 * requireTeamRole first; nothing else may read a team row directly.
 *
 * Errors as values throughout. A caller that cannot distinguish
 * "not a member" from "not privileged enough" would leak team existence,
 * so both collapse to the same outward answer at the route layer while
 * staying distinct here for logging.
 *
 * Called by: team invite/member actions, and the REST + MCP team surfaces.
 * Tables touched: team_members (read).
 */

export type MembershipLookup =
  | { ok: true; role: TeamRole }
  | { ok: false; reason: "not_a_member" | "lookup_failed"; message: string };

/** Resolves the caller's role in a team, or reports why it could not. */
export async function getTeamRole(
  principalId: string,
  teamId: string,
): Promise<MembershipLookup> {
  const { data: membershipRow, error: lookupError } = await adminSupabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("principal_id", principalId)
    .maybeSingle();

  if (lookupError) {
    console.error(
      `[getTeamRole] Membership lookup failed for team ${teamId}:`,
      lookupError.message,
    );
    return {
      ok: false,
      reason: "lookup_failed",
      message: "Could not verify team membership.",
    };
  }

  if (!membershipRow) {
    return {
      ok: false,
      reason: "not_a_member",
      message: "You are not a member of this team.",
    };
  }

  // The column is constrained in SQL, but a value arriving from the DB is
  // still input as far as this process is concerned. Failing closed on an
  // unrecognized role beats silently treating it as a member.
  if (!isTeamRole(membershipRow.role)) {
    console.error(
      `[getTeamRole] Unrecognized role "${membershipRow.role}" on team ${teamId}.`,
    );
    return {
      ok: false,
      reason: "lookup_failed",
      message: "Could not verify team membership.",
    };
  }

  return { ok: true, role: membershipRow.role };
}

export type AuthorizationResult =
  | { ok: true; role: TeamRole }
  | {
      ok: false;
      reason: "not_a_member" | "insufficient_role" | "lookup_failed";
      message: string;
    };

/**
 * Asserts the caller holds at least `requiredRole` in the team.
 *
 * Comparison goes through roleMeets, never through string ordering: a
 * lexical compare would rank "admin" above "owner" and invert the check.
 */
export async function requireTeamRole(
  principalId: string,
  teamId: string,
  requiredRole: TeamRole,
): Promise<AuthorizationResult> {
  const membership = await getTeamRole(principalId, teamId);
  if (!membership.ok) return membership;

  if (!roleMeets(membership.role, requiredRole)) {
    return {
      ok: false,
      reason: "insufficient_role",
      message: `This action requires the ${requiredRole} role.`,
    };
  }

  return { ok: true, role: membership.role };
}

export type TeamMemberSummary = {
  principalId: string;
  role: TeamRole;
  joinedAt: string;
};

export type ListMembersResult =
  | { ok: true; members: TeamMemberSummary[] }
  | { ok: false; message: string };

/**
 * Lists a team's members. The caller must already be a member; this
 * function enforces that rather than trusting the route to have done it.
 */
export async function listTeamMembers(
  principalId: string,
  teamId: string,
): Promise<ListMembersResult> {
  const authorization = await requireTeamRole(principalId, teamId, "member");
  if (!authorization.ok) {
    return { ok: false, message: authorization.message };
  }

  const { data: memberRows, error: listError } = await adminSupabase
    .from("team_members")
    .select("principal_id, role, joined_at")
    .eq("team_id", teamId)
    .order("joined_at", { ascending: true });

  if (listError) {
    console.error(
      `[listTeamMembers] Member list failed for team ${teamId}:`,
      listError.message,
    );
    return { ok: false, message: "Could not load team members." };
  }

  const members = (memberRows ?? [])
    .filter((row) => isTeamRole(row.role))
    .map((row) => ({
      principalId: row.principal_id,
      // Narrowed by the filter above; isTeamRole is the type guard.
      role: row.role as TeamRole,
      joinedAt: row.joined_at,
    }));

  return { ok: true, members };
}

export type TeamsForPrincipal = {
  teamId: string;
  name: string;
  role: TeamRole;
};

export type ListTeamsResult =
  | { ok: true; teams: TeamsForPrincipal[] }
  | { ok: false; message: string };

/** Every team the principal belongs to, with their role in each. */
export async function listTeamsForPrincipal(
  principalId: string,
): Promise<ListTeamsResult> {
  const { data: membershipRows, error: listError } = await adminSupabase
    .from("team_members")
    .select("team_id, role, teams(name)")
    .eq("principal_id", principalId);

  if (listError) {
    console.error(
      `[listTeamsForPrincipal] Lookup failed for ${principalId}:`,
      listError.message,
    );
    return { ok: false, message: "Could not load your teams." };
  }

  const teams = (membershipRows ?? [])
    .filter((row) => isTeamRole(row.role))
    .map((row) => {
      // The embedded relation arrives as an object (one team per row);
      // read it defensively so a shape change degrades to a blank name
      // rather than throwing inside a list mapper.
      const embeddedTeam = row.teams as { name?: unknown } | null;
      const teamName =
        embeddedTeam && typeof embeddedTeam.name === "string"
          ? embeddedTeam.name
          : "";
      return {
        teamId: row.team_id,
        name: teamName,
        role: row.role as TeamRole,
      };
    });

  return { ok: true, teams };
}
