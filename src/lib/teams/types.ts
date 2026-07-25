/**
 * Team model types.
 *
 * Declared here rather than imported from database.types.ts because the
 * tables are created by hand (see docs/DB_CHANGES_TEAMS.md) and that file
 * is never regenerated. Once the tables exist and the union is edited in,
 * these can be narrowed to Tables<"teams"> and friends.
 *
 * Client-safe: types only, plus the role helpers the UI needs.
 */

/** Roles, ordered least to most privileged. */
export const TEAM_ROLES = ["member", "admin", "owner"] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

/** Roles an invite may grant. Owner is excluded on purpose: an invite that
 * could mint an owner would make takeover one leaked link away. Ownership
 * transfer is its own deliberate action. */
export const INVITABLE_ROLES = ["member", "admin"] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export type Team = {
  id: string;
  name: string;
  ownerPrincipalId: string;
  createdAt: string;
};

export type TeamMember = {
  id: string;
  teamId: string;
  principalId: string;
  role: TeamRole;
  joinedAt: string;
};

export type TeamInvite = {
  id: string;
  teamId: string;
  email: string;
  role: InvitableRole;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/**
 * Rank used for privilege comparisons. Higher outranks lower.
 * Never compare role strings directly; a lexical compare puts "admin"
 * above "owner" and silently inverts the check.
 */
const ROLE_RANK: Record<TeamRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

/** True when `role` is at least as privileged as `required`. */
export function roleMeets(role: TeamRole, required: TeamRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/** Type guard for values arriving from the DB or a request body. */
export function isTeamRole(value: string): value is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

/** Type guard for the invite-role subset. */
export function isInvitableRole(value: string): value is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(value);
}
