"use client";

import type { CreatorInfoData } from "@/lib/api/tiktok/data/getTikTokCreatorInfo";
import { getTikTokCreatorInfoForAccount } from "@/lib/api/tiktok/data/getTikTokCreatorInfoForAccount";
import type { ClientSocialAccount } from "@/lib/types/dbTypes";
import { useRef, useState } from "react";

export type { CreatorInfoData };

type CreatorInfoOutcome =
  | { ok: true; data: CreatorInfoData }
  | { ok: false; message: string };

async function fetchCreatorInfoOutcome(
  accountId: string,
): Promise<CreatorInfoOutcome> {
  try {
    const result = await getTikTokCreatorInfoForAccount(accountId);
    return result.success
      ? { ok: true, data: result.data }
      : { ok: false, message: result.message };
  } catch (error) {
    console.error("[fetchCreatorInfoOutcome] Creator info request failed:", error);
    return { ok: false, message: "Could not load TikTok creator info." };
  }
}

export function useTikTokCreatorInfo(socialAccounts: ClientSocialAccount[]) {
  const [outcomes, setOutcomes] = useState<Record<string, CreatorInfoOutcome>>(
    {},
  );
  const requestedAccountIdsRef = useRef(new Set<string>());

  function loadCreatorInfoForAccount(accountId: string) {
    if (requestedAccountIdsRef.current.has(accountId)) return;
    requestedAccountIdsRef.current.add(accountId);

    fetchCreatorInfoOutcome(accountId).then((outcome) => {
      setOutcomes((previousOutcomes) => ({
        ...previousOutcomes,
        [accountId]: outcome,
      }));
    });
  }

  const creatorInfo: Record<string, CreatorInfoData> = {};
  const isLoading: Record<string, boolean> = {};
  const errors: Record<string, string | null> = {};
  for (const account of socialAccounts) {
    const outcome = outcomes[account.id];
    isLoading[account.id] = outcome === undefined;
    errors[account.id] = outcome && !outcome.ok ? outcome.message : null;
    if (outcome?.ok) {
      creatorInfo[account.id] = outcome.data;
    }
  }

  return { creatorInfo, isLoading, errors, loadCreatorInfoForAccount };
}
