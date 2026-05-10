"use client";

import {
  getTikTokCreatorInfo,
  type CreatorInfoData,
} from "@/lib/api/tiktok/data/getTikTokCreatorInfo";
import type { SocialAccount } from "@/lib/types/dbTypes";
import { useEffect, useRef, useState } from "react";

export type { CreatorInfoData };

export function useTikTokCreatorInfo(
  socialAccounts: SocialAccount[],
  enabled: boolean
) {
  const [creatorInfo, setCreatorInfo] = useState<
    Record<string, CreatorInfoData>
  >({});
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const fetchedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;

    for (const account of socialAccounts) {
      if (!account.access_token || fetchedRef.current.has(account.id)) continue;
      fetchedRef.current.add(account.id);

      setIsLoading((prev) => ({ ...prev, [account.id]: true }));

      getTikTokCreatorInfo(account.access_token).then((result) => {
        if (result.success) {
          setCreatorInfo((prev) => ({ ...prev, [account.id]: result.data }));
          setErrors((prev) => ({ ...prev, [account.id]: null }));
        } else {
          setErrors((prev) => ({ ...prev, [account.id]: result.message }));
        }
        setIsLoading((prev) => ({ ...prev, [account.id]: false }));
      });
    }
  }, [enabled, socialAccounts]);

  function refetch(accountId: string) {
    fetchedRef.current.delete(accountId);
    const account = socialAccounts.find((a) => a.id === accountId);
    if (!account?.access_token) return;

    fetchedRef.current.add(accountId);
    setIsLoading((prev) => ({ ...prev, [accountId]: true }));
    setErrors((prev) => ({ ...prev, [accountId]: null }));

    getTikTokCreatorInfo(account.access_token).then((result) => {
      if (result.success) {
        setCreatorInfo((prev) => ({ ...prev, [accountId]: result.data }));
        setErrors((prev) => ({ ...prev, [accountId]: null }));
      } else {
        setErrors((prev) => ({ ...prev, [accountId]: result.message }));
      }
      setIsLoading((prev) => ({ ...prev, [accountId]: false }));
    });
  }

  return { creatorInfo, isLoading, errors, refetch };
}
