import "server-only";

import { createHash } from "node:crypto";

import type {
  CredentialsConnectInput,
  ProviderBehavior,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
} from "./types";
import { toJsonObject } from "@/lib/utils/jsonObject";

import { parseJsonObject, providerFetch } from "./_shared/providerFetch";
import {
  failHttpAnswer,
  failProviderFetch,
  failUnreadableAnswer,
  refusePublish,
} from "./_shared/publishFailure";
import { joinTitleAndBody } from "./_shared/postText";
import { truncateToGraphemesAndBytes } from "./_shared/textLimits";
import { REGISTRY_PROVIDER_CATALOG } from "./catalog";

const MISC_TIMEOUT_MS = 30_000;

const NEYNAR_API = "https://api.neynar.com/v2/farcaster";
// farcasterxyz/protocol docs/SPECIFICATION.md (CastAddBody): text "must
// contain <= 1024 bytes", and CastType.CAST covers a text length of 0 to 320
// while LONG_CAST covers 321 to 1024. Neynar's publish-cast body takes no
// cast type, so a cast stays within 320 UTF-8 bytes.
const FARCASTER_CAST_LIMITS = {
  maxGraphemes: REGISTRY_PROVIDER_CATALOG.farcaster.rules.maxTextLength,
  maxUtf8Bytes: 320,
};

// docs.neynar.com/reference/publish-cast: `idem` "is used to prevent duplicate
// requests. Use the same idem key on retry attempts", 16 characters advised.
const NEYNAR_IDEMPOTENCY_KEY_CHARS = 16;

async function farcasterConnect(
  input: CredentialsConnectInput,
): Promise<ProviderConnectResult> {
  const apiKey = (input.values.neynarApiKey ?? "").trim();
  const signerUuid = (input.values.signerUuid ?? "").trim();
  if (!apiKey || !signerUuid) {
    return {
      ok: false,
      message: "Neynar API key and signer UUID are both required.",
    };
  }

  const signerResult = await providerFetch(
    `${NEYNAR_API}/signer?signer_uuid=${encodeURIComponent(signerUuid)}`,
    {
      method: "GET",
      headers: { "x-api-key": apiKey },
      timeoutMs: MISC_TIMEOUT_MS,
    },
  );
  if (!signerResult.ok) return { ok: false, message: signerResult.message };
  if (signerResult.status !== 200) {
    return {
      ok: false,
      message: `Neynar rejected the credentials (HTTP ${signerResult.status}).`,
    };
  }
  const signer = parseJsonObject(signerResult.bodyText);
  const status = signer && typeof signer.status === "string" ? signer.status : null;
  if (status !== "approved") {
    return {
      ok: false,
      message: `That signer is not approved yet (status: ${status ?? "unknown"}). Approve it in Warpcast first.`,
    };
  }
  const fid = signer && typeof signer.fid === "number" ? String(signer.fid) : null;
  if (!fid) return { ok: false, message: "Neynar returned no FID for the signer." };

  return {
    ok: true,
    accessToken: apiKey,
    refreshToken: null,
    expiresIn: null,
    identity: {
      accountIdentifier: fid,
      displayName: `FID ${fid}`,
      username: null,
      avatarUrl: null,
    },
    config: { signerUuid, fid },
  };
}

async function farcasterPublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const signerUuid =
    typeof input.config.signerUuid === "string" ? input.config.signerUuid : null;
  if (!signerUuid) {
    return refusePublish("Stored Farcaster account has no signer.");
  }

  const text = truncateToGraphemesAndBytes(joinTitleAndBody(input), FARCASTER_CAST_LIMITS);
  const idempotencyKey = createHash("sha256")
    .update(`${input.accountIdentifier}:${input.idempotencyKey}`)
    .digest("hex")
    .slice(0, NEYNAR_IDEMPOTENCY_KEY_CHARS);

  const castPayload: Record<string, unknown> = {
    signer_uuid: signerUuid,
    text,
    idem: idempotencyKey,
  };
  // Media rides as an embed URL; Farcaster clients render it inline.
  if (input.mediaUrl) castPayload.embeds = [{ url: input.mediaUrl }];

  const result = await providerFetch(`${NEYNAR_API}/cast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": input.accessToken,
    },
    body: JSON.stringify(castPayload),
    timeoutMs: MISC_TIMEOUT_MS,
  });

  if (!result.ok) {
    return failProviderFetch({ platform: "farcaster", stage: "publish", fetchFailure: result });
  }
  if (result.status !== 200) {
    return failHttpAnswer({
      platform: "farcaster",
      stage: "publish",
      action: "Farcaster cast",
      httpStatus: result.status,
      bodyText: result.bodyText,
    });
  }

  const cast = toJsonObject(parseJsonObject(result.bodyText)?.cast);
  const castHash = cast && typeof cast.hash === "string" ? cast.hash : null;
  if (!castHash) {
    return failUnreadableAnswer({ message: "Neynar returned no cast hash.", stage: "publish" });
  }

  return { ok: true, postId: castHash, postUrl: null };
}

export const farcasterBehavior = {
  authKind: "credentials",
  connect: farcasterConnect,
  publish: farcasterPublish,
} satisfies ProviderBehavior;

function normalizeListmonkUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, "");
}

function listmonkAuthHeader(credential: string): string {
  return `Basic ${Buffer.from(credential, "utf-8").toString("base64")}`;
}

async function listmonkConnect(
  input: CredentialsConnectInput,
): Promise<ProviderConnectResult> {
  const instanceUrl = normalizeListmonkUrl(input.values.instanceUrl ?? "");
  const apiUser = (input.values.apiUser ?? "").trim();
  const apiToken = (input.values.apiToken ?? "").trim();
  const listId = Number(input.values.listId ?? "");
  if (!instanceUrl || !apiUser || !apiToken) {
    return {
      ok: false,
      message: "Instance URL, API user, and API token are all required.",
    };
  }
  if (!Number.isInteger(listId) || listId <= 0) {
    return { ok: false, message: "A numeric list ID is required." };
  }

  const credential = `${apiUser}:${apiToken}`;
  const listResult = await providerFetch(
    `${instanceUrl}/api/lists/${listId}`,
    {
      method: "GET",
      headers: { Authorization: listmonkAuthHeader(credential) },
      timeoutMs: MISC_TIMEOUT_MS,
    },
  );
  if (!listResult.ok) return { ok: false, message: listResult.message };
  if (listResult.status === 401) {
    return { ok: false, message: "Listmonk rejected the API credentials." };
  }
  if (listResult.status !== 200) {
    return {
      ok: false,
      message: `Listmonk list lookup failed (HTTP ${listResult.status}). Check the list ID.`,
    };
  }

  const listData = toJsonObject(parseJsonObject(listResult.bodyText)?.data);
  const listName =
    listData && typeof listData.name === "string" ? listData.name : `List ${listId}`;

  return {
    ok: true,
    accessToken: credential,
    refreshToken: null,
    expiresIn: null,
    identity: {
      accountIdentifier: `${instanceUrl}#list-${listId}`,
      displayName: listName,
      username: apiUser,
      avatarUrl: null,
    },
    config: { instanceUrl, listId },
  };
}

async function listmonkPublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const instanceUrl =
    typeof input.config.instanceUrl === "string"
      ? normalizeListmonkUrl(input.config.instanceUrl)
      : null;
  const listId =
    typeof input.config.listId === "number" ? input.config.listId : null;
  if (!instanceUrl || !listId) {
    return refusePublish("Stored Listmonk account is incomplete.");
  }
  const subject = input.title.trim();
  if (!subject) {
    return refusePublish("A newsletter needs a subject (title).");
  }

  const authorization = listmonkAuthHeader(input.accessToken);
  const htmlBody =
    input.postType === "image" && input.mediaUrl
      ? `<p><img src="${escapeHtml(input.mediaUrl)}" alt="" style="max-width:100%"/></p>${renderTextAsHtmlParagraphs(input.body)}`
      : renderTextAsHtmlParagraphs(input.body);

  const createResult = await providerFetch(`${instanceUrl}/api/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify({
      name: subject,
      subject,
      lists: [listId],
      type: "regular",
      content_type: "html",
      body: htmlBody,
    }),
    timeoutMs: MISC_TIMEOUT_MS,
  });
  if (!createResult.ok) {
    return failProviderFetch({
      platform: "listmonk",
      stage: "prepare",
      fetchFailure: createResult,
    });
  }
  if (createResult.status !== 200) {
    return failHttpAnswer({
      platform: "listmonk",
      stage: "prepare",
      action: "Listmonk campaign create",
      httpStatus: createResult.status,
      bodyText: createResult.bodyText,
    });
  }
  const campaign = toJsonObject(parseJsonObject(createResult.bodyText)?.data);
  const campaignId =
    campaign && typeof campaign.id === "number" ? campaign.id : null;
  if (!campaignId) {
    return failUnreadableAnswer({
      message: "Listmonk returned no campaign id.",
      stage: "prepare",
    });
  }

  const startResult = await providerFetch(
    `${instanceUrl}/api/campaigns/${campaignId}/status`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: JSON.stringify({ status: "running" }),
      timeoutMs: MISC_TIMEOUT_MS,
    },
  );
  if (!startResult.ok) {
    return failProviderFetch({
      platform: "listmonk",
      stage: "publish",
      fetchFailure: startResult,
    });
  }
  if (startResult.status !== 200) {
    return failHttpAnswer({
      platform: "listmonk",
      stage: "publish",
      action: `Campaign ${campaignId} was created but starting it`,
      httpStatus: startResult.status,
      bodyText: startResult.bodyText,
    });
  }

  return {
    ok: true,
    postId: String(campaignId),
    postUrl: `${instanceUrl}/admin/campaigns/${campaignId}`,
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderTextAsHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${escapeHtml(block).replaceAll("\n", "<br/>")}</p>`)
    .join("");
}

export const listmonkBehavior = {
  authKind: "credentials",
  connect: listmonkConnect,
  publish: listmonkPublish,
} satisfies ProviderBehavior;
