"use client";

import { useState } from "react";
import { SocialAccount } from "@/lib/types/dbTypes";

export type AccountContentEntry = {
  accountId: string;
  title: string;
  description: string;
  link: string;
  isCustomized: boolean;
};

export function useAccountContent() {
  const [accountContent, setAccountContent] = useState<AccountContentEntry[]>(
    []
  );

  /**
   * Called when an account is toggled ON. Adds a new entry with the
   * current default text values. Idempotent: skips if already present.
   */
  function addAccountContent(
    account: SocialAccount,
    defaultText: { title: string; description: string; link: string },
    pinterestLink: string
  ) {
    setAccountContent((prev) => {
      if (prev.some((item) => item.accountId === account.id)) return prev;
      return [
        ...prev,
        {
          accountId: account.id,
          title: defaultText.title,
          description: defaultText.description,
          link:
            account.platform === "pinterest"
              ? pinterestLink
              : defaultText.link,
          isCustomized: false,
        },
      ];
    });
  }

  /** Called when an account is toggled OFF. */
  function removeAccountContent(accountId: string) {
    setAccountContent((prev) =>
      prev.filter((item) => item.accountId !== accountId)
    );
  }

  /**
   * Called when the default caption/title/link text inputs change.
   * Updates only entries that have NOT been customized by the user.
   */
  function updateDefaultText(
    textInputs: { title: string; description: string; link: string },
    pinterestLink: string,
    selectedPinterestIds: string[]
  ) {
    setAccountContent((prev) =>
      prev.map((item) => {
        if (item.isCustomized) return item;
        return {
          ...item,
          description: textInputs.description,
          title: textInputs.title,
          link: selectedPinterestIds.includes(item.accountId)
            ? pinterestLink
            : textInputs.link,
        };
      })
    );
  }

  /** Called from CaptionsTab when a user edits a per-account caption. */
  function setCustomCaption(
    accountId: string,
    description: string,
    isCustomized: boolean
  ) {
    setAccountContent((prev) =>
      prev.map((item) =>
        item.accountId === accountId
          ? { ...item, description, isCustomized }
          : item
      )
    );
  }

  /** Reverts a single account's content to the current defaults. */
  function clearCustomization(
    accountId: string,
    defaultDescription: string,
    defaultTitle: string
  ) {
    setAccountContent((prev) =>
      prev.map((item) =>
        item.accountId === accountId
          ? {
              ...item,
              isCustomized: false,
              description: defaultDescription,
              title: defaultTitle,
            }
          : item
      )
    );
  }

  /** Called from resetForm. */
  function resetContent() {
    setAccountContent([]);
  }

  return {
    accountContent,
    addAccountContent,
    removeAccountContent,
    updateDefaultText,
    setCustomCaption,
    clearCustomization,
    resetContent,
  };
}
