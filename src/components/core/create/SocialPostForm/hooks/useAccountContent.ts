"use client";

import { useState } from "react";
import { ClientSocialAccount } from "@/lib/types/dbTypes";

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

  function addAccountContent(
    account: ClientSocialAccount,
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

  function removeAccountContent(accountId: string) {
    setAccountContent((prev) =>
      prev.filter((item) => item.accountId !== accountId)
    );
  }

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
