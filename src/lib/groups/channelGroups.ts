import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * Channel groups: the agency model, where each connected channel belongs
 * to at most one client bucket and every listing surface can be filtered
 * to one client.
 *
 * Ownership is enforced the same way everywhere else in this codebase is:
 * every query carries an explicit principal_id filter, so another
 * principal's group id simply returns nothing rather than being rejected
 * with a message that confirms it exists.
 *
 * Called by: the groups REST routes, the connections list filter, and the
 * MCP list_connections tool.
 * Tables touched: channel_groups, channel_group_members, social_accounts.
 */

/** Same ceiling as the SQL CHECK, so the error comes from here first. */
const GROUP_NAME_MAX_LENGTH = 80;

export type ChannelGroup = {
  id: string;
  name: string;
  channelCount: number;
  createdAt: string;
};

export type CreateGroupResult =
  | { ok: true; groupId: string }
  | {
      ok: false;
      reason: "invalid_name" | "duplicate_name" | "insert_failed";
      message: string;
    };

/** Creates a client bucket owned by the calling principal. */
export async function createChannelGroup(params: {
  principalId: string;
  name: string;
}): Promise<CreateGroupResult> {
  const name = params.name.trim();
  if (name.length === 0 || name.length > GROUP_NAME_MAX_LENGTH) {
    return {
      ok: false,
      reason: "invalid_name",
      message: `Group name must be 1 to ${GROUP_NAME_MAX_LENGTH} characters.`,
    };
  }

  const { data: insertedGroup, error: insertError } = await adminSupabase
    .from("channel_groups")
    .insert({ principal_id: params.principalId, name })
    .select("id")
    .single();

  if (insertError) {
    // 23505 is the (principal_id, name) unique index: a bucket with this
    // name already exists, which is worth saying plainly.
    if ((insertError as { code?: string }).code === "23505") {
      return {
        ok: false,
        reason: "duplicate_name",
        message: `You already have a group called "${name}".`,
      };
    }
    console.error("[createChannelGroup] Insert failed:", insertError.message);
    return {
      ok: false,
      reason: "insert_failed",
      message: "Could not create the group.",
    };
  }

  return { ok: true, groupId: insertedGroup.id };
}

export type ListGroupsResult =
  | { ok: true; groups: ChannelGroup[] }
  | { ok: false; message: string };

/** Lists the principal's groups with how many channels sit in each. */
export async function listChannelGroups(
  principalId: string,
): Promise<ListGroupsResult> {
  const { data: groupRows, error: listError } = await adminSupabase
    .from("channel_groups")
    .select("id, name, created_at, channel_group_members(id)")
    .eq("principal_id", principalId)
    .order("name", { ascending: true });

  if (listError) {
    console.error("[listChannelGroups] Lookup failed:", listError.message);
    return { ok: false, message: "Could not load your groups." };
  }

  const groups = (groupRows ?? []).map((row) => {
    // The embedded relation arrives as an array of member rows; its length
    // is the count. Read defensively so a shape change degrades to 0
    // rather than throwing inside a list mapper.
    const members = row.channel_group_members;
    return {
      id: row.id,
      name: row.name,
      channelCount: Array.isArray(members) ? members.length : 0,
      createdAt: row.created_at,
    };
  });

  return { ok: true, groups };
}

export type AssignChannelResult =
  | { ok: true; moved: boolean }
  | {
      ok: false;
      reason: "group_not_found" | "channel_not_found" | "assign_failed";
      message: string;
    };

/**
 * Puts a channel in a group, moving it out of any previous one.
 *
 * Both the group and the channel are verified to belong to the caller
 * before anything is written. Skipping either check would let a caller
 * file someone else's channel under their own client, or read a channel
 * count that is not theirs.
 *
 * A channel already in another group is MOVED, because the unique
 * constraint on social_account_id makes one client per channel the model.
 */
export async function assignChannelToGroup(params: {
  principalId: string;
  groupId: string;
  socialAccountId: string;
}): Promise<AssignChannelResult> {
  const groupCheck = await adminSupabase
    .from("channel_groups")
    .select("id")
    .eq("id", params.groupId)
    .eq("principal_id", params.principalId)
    .maybeSingle();

  if (groupCheck.error) {
    console.error(
      "[assignChannelToGroup] Group lookup failed:",
      groupCheck.error.message,
    );
    return {
      ok: false,
      reason: "assign_failed",
      message: "Could not verify the group.",
    };
  }
  if (!groupCheck.data) {
    return {
      ok: false,
      reason: "group_not_found",
      message: "Group not found.",
    };
  }

  const channelCheck = await adminSupabase
    .from("social_accounts")
    .select("id")
    .eq("id", params.socialAccountId)
    .eq("principal_id", params.principalId)
    .is("deleted_at", null)
    .maybeSingle();

  if (channelCheck.error) {
    console.error(
      "[assignChannelToGroup] Channel lookup failed:",
      channelCheck.error.message,
    );
    return {
      ok: false,
      reason: "assign_failed",
      message: "Could not verify the channel.",
    };
  }
  if (!channelCheck.data) {
    return {
      ok: false,
      reason: "channel_not_found",
      message: "Connection not found.",
    };
  }

  // Upsert on the social_account_id unique index turns "move between
  // groups" into one statement with no window where the channel belongs
  // to neither group.
  const { error: assignError } = await adminSupabase
    .from("channel_group_members")
    .upsert(
      {
        group_id: params.groupId,
        social_account_id: params.socialAccountId,
      },
      { onConflict: "social_account_id" },
    );

  if (assignError) {
    console.error("[assignChannelToGroup] Assign failed:", assignError.message);
    return {
      ok: false,
      reason: "assign_failed",
      message: "Could not add the channel to that group.",
    };
  }

  return { ok: true, moved: true };
}

export type RemoveChannelResult =
  | { ok: true; removed: boolean }
  | { ok: false; message: string };

/** Takes a channel out of whatever group it is in. */
export async function removeChannelFromGroups(params: {
  principalId: string;
  socialAccountId: string;
}): Promise<RemoveChannelResult> {
  // Verify ownership of the channel first: the members table has no
  // principal column, so deleting by social_account_id alone would let a
  // caller unfile someone else's channel.
  const channelCheck = await adminSupabase
    .from("social_accounts")
    .select("id")
    .eq("id", params.socialAccountId)
    .eq("principal_id", params.principalId)
    .maybeSingle();

  if (channelCheck.error || !channelCheck.data) {
    return { ok: false, message: "Connection not found." };
  }

  const { data: deletedRows, error: deleteError } = await adminSupabase
    .from("channel_group_members")
    .delete()
    .eq("social_account_id", params.socialAccountId)
    .select("id");

  if (deleteError) {
    console.error(
      "[removeChannelFromGroups] Delete failed:",
      deleteError.message,
    );
    return { ok: false, message: "Could not remove the channel." };
  }

  return { ok: true, removed: (deletedRows ?? []).length > 0 };
}

export type GroupChannelIdsResult =
  | { ok: true; socialAccountIds: string[] }
  | { ok: false; message: string };

/**
 * The channel ids in one group, for filtering a connections or posts
 * listing by client. Returns an empty list for a group the caller does not
 * own, so a filter can never widen a listing to someone else's channels.
 */
export async function listChannelIdsInGroup(params: {
  principalId: string;
  groupId: string;
}): Promise<GroupChannelIdsResult> {
  const groupCheck = await adminSupabase
    .from("channel_groups")
    .select("id")
    .eq("id", params.groupId)
    .eq("principal_id", params.principalId)
    .maybeSingle();

  if (groupCheck.error) {
    console.error(
      "[listChannelIdsInGroup] Group lookup failed:",
      groupCheck.error.message,
    );
    return { ok: false, message: "Could not load the group." };
  }
  if (!groupCheck.data) {
    // Not an error to the caller: an unknown or foreign group simply
    // contains none of their channels.
    return { ok: true, socialAccountIds: [] };
  }

  const { data: memberRows, error: listError } = await adminSupabase
    .from("channel_group_members")
    .select("social_account_id")
    .eq("group_id", params.groupId);

  if (listError) {
    console.error("[listChannelIdsInGroup] Lookup failed:", listError.message);
    return { ok: false, message: "Could not load the group's channels." };
  }

  return {
    ok: true,
    socialAccountIds: (memberRows ?? []).map((row) => row.social_account_id),
  };
}
