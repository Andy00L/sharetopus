import "server-only";

import type {
  ProviderBehavior,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
} from "./types";
import {
  parseJsonBody,
  providerFetch,
  readStringField,
} from "./_shared/providerFetch";

/**
 * Credentials-based providers: Farcaster (via a Neynar managed signer) and
 * Listmonk (self-hosted newsletter).
 *
 * sourceRef: docs.neynar.com (v2/farcaster/cast, x-api-key + signer_uuid);
 * listmonk.app/docs/apis (basic auth, campaigns, campaign status).
 */

const MISC_TIMEOUT_MS = 30_000;

// ── Farcaster (Neynar) ────────────────────────────────────────────────────

const NEYNAR_API = "https://api.neynar.com/v2/farcaster";
/** Farcaster casts cap at 320 bytes; 320 chars is the practical bound. */
const FARCASTER_MAX_CHARS = 320;

async function farcasterConnect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return {
      ok: false,
      message: "Farcaster connects with a Neynar API key and signer UUID.",
    };
  }
  const apiKey = (input.values.neynarApiKey ?? "").trim();
  const signerUuid = (input.values.signerUuid ?? "").trim();
  if (!apiKey || !signerUuid) {
    return {
      ok: false,
      message: "Neynar API key and signer UUID are both required.",
    };
  }

  // The signer lookup proves both credentials at once and yields the FID.
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
  const signer = parseJsonBody(signerResult.bodyText) as Record<string, unknown> | null;
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
    // The API key is the credential; the signer UUID is config.
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
    return { ok: false, message: "Stored Farcaster account has no signer." };
  }

  const text = [input.title.trim(), input.body.trim()]
    .filter((part) => part.length > 0)
    .join("\n\n")
    .slice(0, FARCASTER_MAX_CHARS);

  const castPayload: Record<string, unknown> = { signer_uuid: signerUuid, text };
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

  if (!result.ok) return { ok: false, message: result.message };
  if (result.status === 429) {
    return { ok: false, message: "Neynar rate limit reached (429)." };
  }
  if (result.status !== 200) {
    return {
      ok: false,
      message: `Farcaster cast failed (${result.status}): ${result.bodyText.slice(0, 200)}`,
    };
  }

  const parsed = parseJsonBody(result.bodyText) as Record<string, unknown> | null;
  const cast =
    parsed && typeof parsed.cast === "object" && parsed.cast !== null
      ? (parsed.cast as Record<string, unknown>)
      : null;
  const castHash = cast && typeof cast.hash === "string" ? cast.hash : null;
  if (!castHash) return { ok: false, message: "Neynar returned no cast hash." };

  return { ok: true, postId: castHash, postUrl: null };
}

export const farcasterBehavior: ProviderBehavior = {
  connect: farcasterConnect,
  publish: farcasterPublish,
};

// ── Listmonk ──────────────────────────────────────────────────────────────

function normalizeListmonkUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, "");
}

function listmonkAuthHeader(credential: string): string {
  return `Basic ${Buffer.from(credential, "utf-8").toString("base64")}`;
}

async function listmonkConnect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return { ok: false, message: "Listmonk connects with an API user and token." };
  }
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

  const parsed = parseJsonBody(listResult.bodyText) as Record<string, unknown> | null;
  const listData =
    parsed && typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : null;
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
    return { ok: false, message: "Stored Listmonk account is incomplete." };
  }
  const subject = input.title.trim();
  if (!subject) {
    return { ok: false, message: "A newsletter needs a subject (title)." };
  }

  const authorization = listmonkAuthHeader(input.accessToken);
  const htmlBody =
    input.mediaType === "image" && input.mediaUrl
      ? `<p><img src="${input.mediaUrl}" alt="" style="max-width:100%"/></p>${paragraphs(input.body)}`
      : paragraphs(input.body);

  // Step 1: create the campaign.
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
  if (!createResult.ok) return { ok: false, message: createResult.message };
  if (createResult.status !== 200) {
    return {
      ok: false,
      message: `Listmonk campaign create failed (${createResult.status}): ${createResult.bodyText.slice(0, 200)}`,
    };
  }
  const created = parseJsonBody(createResult.bodyText) as Record<string, unknown> | null;
  const campaign =
    created && typeof created.data === "object" && created.data !== null
      ? (created.data as Record<string, unknown>)
      : null;
  const campaignId =
    campaign && typeof campaign.id === "number" ? campaign.id : null;
  if (!campaignId) {
    return { ok: false, message: "Listmonk returned no campaign id." };
  }

  // Step 2: start sending. A campaign left in draft would silently never
  // reach anyone, which is not what "publish" means.
  const startResult = await providerFetch(
    `${instanceUrl}/api/campaigns/${campaignId}/status`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: JSON.stringify({ status: "running" }),
      timeoutMs: MISC_TIMEOUT_MS,
    },
  );
  if (!startResult.ok) return { ok: false, message: startResult.message };
  if (startResult.status !== 200) {
    return {
      ok: false,
      message: `Campaign ${campaignId} was created but could not be started (${startResult.status}). Start it from the Listmonk dashboard.`,
    };
  }

  return {
    ok: true,
    postId: String(campaignId),
    postUrl: `${instanceUrl}/admin/campaigns/${campaignId}`,
  };
}

/** Minimal text-to-HTML: blank-line-separated paragraphs, escaped. */
function paragraphs(text: string): string {
  const escape = (line: string) =>
    line
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${escape(block).replaceAll("\n", "<br/>")}</p>`)
    .join("");
}

export const listmonkBehavior: ProviderBehavior = {
  connect: listmonkConnect,
  publish: listmonkPublish,
};
